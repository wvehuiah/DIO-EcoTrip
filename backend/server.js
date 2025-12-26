import fetch from "node-fetch";
import express from "express";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import { buildReceiptPdf } from "./pdf.js";
import {fileURLToPath} from "url";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT || 3000);
const ORS_API_KEY = process.env.ORS_API_KEY;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname, "../frontend");
const CALCS = new Map(); // calcId -> record
const FACTORS = { bike: 0.0, bus: 0.089, car: 0.12, truck: 0.96 };
const FACTORS_VERSION = "v1.0.0";
const CREDIT_PRICE = { base: 45, min: 25, max: 85 };

const MODE_LABEL = {
    bike: "Bicicleta",
    bus: "Ônibus",
    car: "Carro",
    truck: "Caminhão"
};

function newCalcId() {
    // curto e único, bom pra URL/recibo
    return crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
}


// LOG de requests (você vai enxergar se a API está sendo chamada)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// servir frontend
app.use(express.static(frontendDir));

app.get("/health", (req, res) => res.json({ok: true}));

async function suggestPlaces(q, size = 6) {
    const url = new URL("https://api.openrouteservice.org/geocode/autocomplete");
    url.searchParams.set("api_key", ORS_API_KEY);
    url.searchParams.set("text", q);
    url.searchParams.set("size", String(size));
    // foca em cidades/locais. Você pode ajustar depois.
    url.searchParams.set("layers", "locality");
    url.searchParams.set("boundary.country", "BR");

    const r = await fetch(url);
    const text = await r.text();

    let data = {};
    try { data = JSON.parse(text); } catch {}

    if (!r.ok) {
        const msg = data?.error?.message || data?.message || `Suggest falhou (${r.status}).`;
        throw new Error(msg);
    }

    const features = Array.isArray(data?.features) ? data.features : [];

    // Retorna label pronto para preencher no input
    return features
        .map(f => ({
            label: f?.properties?.label,
            // opcional: coords se você quiser “fixar” no futuro
            lon: f?.geometry?.coordinates?.[0],
            lat: f?.geometry?.coordinates?.[1]
        }))
        .filter(x => typeof x.label === "string" && x.label.trim().length > 0)
        .slice(0, size);
}

app.get("/api/suggest", async (req, res) => {
    try {
        if (!ORS_API_KEY) return res.status(500).json({ error: "ORS_API_KEY ausente no backend/.env" });

        const q = String(req.query.q || "").trim();
        if (q.length < 3) return res.json({ suggestions: [] });

        const suggestions = await suggestPlaces(q, 6);
        return res.json({ suggestions });
    } catch (e) {
        console.error("ERRO /api/suggest:", e);
        return res.status(500).json({ error: e.message || "Erro interno" });
    }
});

async function geocode(text) {
    const url = new URL("https://api.openrouteservice.org/geocode/search");
    url.searchParams.set("api_key", ORS_API_KEY);
    url.searchParams.set("text", text);
    url.searchParams.set("size", "1");

    const r = await fetch(url);
    if (!r.ok) throw new Error(`Geocode falhou (${r.status}).`);
    const data = await r.json();

    const feature = data?.features?.[0];
    if (!feature) throw new Error("Endereço não encontrado (geocode).");

    const [lon, lat] = feature.geometry.coordinates;
    return {lon, lat};
}

async function directionsDistanceKm(from, to, profile = "driving-car") {
    const url = `https://api.openrouteservice.org/v2/directions/${encodeURIComponent(profile)}`;

    const r = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": ORS_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            coordinates: [
                [from.lon, from.lat],
                [to.lon, to.lat]
            ]
        })
    });

    const text = await r.text(); // <-- captura bruto (debug)
    let data = {};
    try {
        data = JSON.parse(text);
    } catch { /* ignora */
    }

    if (!r.ok) {
        // ORS geralmente devolve msg detalhada em "error"
        const msg = data?.error?.message || data?.message || `Directions falhou (${r.status}).`;
        throw new Error(msg);
    }

    // ✅ Fallbacks de distância (metros): ORS GeoJSON + OSRM-like
    const meters =
        // ORS GeoJSON (v2)
        data?.features?.[0]?.properties?.segments?.[0]?.distance ??
        data?.features?.[0]?.properties?.summary?.distance ??

        // OSRM-like (o seu caso)
        data?.routes?.[0]?.summary?.distance ??
        data?.routes?.[0]?.distance ??

        // somatório de segmentos (ORS)
        (Array.isArray(data?.features?.[0]?.properties?.segments)
            ? data.features[0].properties.segments.reduce((acc, s) => acc + (s?.distance || 0), 0)
            : null) ??

        null;

    if (typeof meters !== "number" || !isFinite(meters) || meters <= 0) {
        console.error("Directions payload (sem distância):", JSON.stringify(data).slice(0, 1200));
        throw new Error("Distância não retornada pela API (payload inesperado).");
    }

    return meters / 1000;
}

app.post("/api/distance", async (req, res) => {
    try {
        if (!ORS_API_KEY) {
            return res.status(500).json({error: "ORS_API_KEY ausente no backend/.env"});
        }

        const {origin, destination, profile} = req.body || {};
        if (!origin || !destination) {
            return res.status(400).json({error: "origin e destination são obrigatórios."});
        }

        const from = await geocode(origin);
        const to = await geocode(destination);

        const km = await directionsDistanceKm(from, to, profile || "driving-car");
        return res.json({origin, destination, distance_km: Number(km.toFixed(2))});
    } catch (e) {
        console.error("ERRO /api/distance:", e);
        return res.status(500).json({error: e.message || "Erro interno."});
    }
});

app.post("/api/calc", async (req, res) => {
    try {
        if (!ORS_API_KEY) return res.status(500).json({ error: "ORS_API_KEY ausente no backend/.env" });

        const { origin, destination, mode } = req.body || {};
        const transport = (mode && typeof mode === "string") ? mode : "truck";

        if (!origin || !destination) {
            return res.status(400).json({ error: "origin e destination são obrigatórios." });
        }
        if (!FACTORS[transport] && transport !== "bike") {
            return res.status(400).json({ error: "mode inválido." });
        }

        // 1) rota
        const from = await geocode(origin);
        const to = await geocode(destination);
        const km = await directionsDistanceKm(from, to, "driving-car");

        // 2) cálculo (backend é a fonte da verdade)
        const emission = km * FACTORS[transport];
        const carEmission = km * FACTORS.car;

        const delta = emission - carEmission;
        const vsPct = carEmission > 0 ? (emission / carEmission) * 100 : 0;

        const credits = emission / 1000;
        const costBase = credits * CREDIT_PRICE.base;
        const costMin = credits * CREDIT_PRICE.min;
        const costMax = credits * CREDIT_PRICE.max;

        // 3) registrar
        const calcId = newCalcId();
        const createdAt = new Date().toISOString();

        const record = {
            calcId,
            createdAt,
            provider: "ORS",
            inputs: {
                origin,
                destination,
                distance_km: Number(km.toFixed(2)),
                mode: transport,
                mode_label: MODE_LABEL[transport] || transport
            },
            results: {
                emission_kg: Number(emission.toFixed(2)),
                car_emission_kg: Number(carEmission.toFixed(2)),
                delta_vs_car_kg: Number(delta.toFixed(2)),
                vs_car_pct: Number(vsPct.toFixed(2)),
                credits_needed: Number(credits.toFixed(4)),
                cost_base_brl: Number(costBase.toFixed(2)),
                cost_min_brl: Number(costMin.toFixed(2)),
                cost_max_brl: Number(costMax.toFixed(2))
            },
            factors: FACTORS,
            factorsVersion: FACTORS_VERSION
        };

        CALCS.set(calcId, record);

        return res.json({
            calc_id: calcId,
            pdf_url: `/api/receipt/${calcId}.pdf`,
            record
        });
    } catch (e) {
        console.error("ERRO /api/calc:", e);
        return res.status(500).json({ error: e.message || "Erro interno." });
    }
});

app.get("/api/receipt/:id.pdf", async (req, res) => {
    const id = String(req.params.id || "").trim();
    const record = CALCS.get(id);

    if (!record) return res.status(404).send("Recibo não encontrado.");

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="OLIMPUS_${id}.pdf"`);

    const doc = buildReceiptPdf({
        calcId: record.calcId,
        createdAt: record.createdAt,
        inputs: record.inputs,
        results: record.results,
        factors: record.factors,
        factorsVersion: record.factorsVersion,
        provider: record.provider
    });

    doc.pipe(res);
    doc.end();
});

// fallback para rotas do frontend
app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDir, "index.html"));
});

app.listen(PORT, () => console.log(`App: http://localhost:${PORT}`));
