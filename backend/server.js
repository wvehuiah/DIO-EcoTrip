/**
 * EcoTrip by Olimpus — backend (Express)
 * - /api/suggest     (autocomplete via ORS geocode)
 * - /api/distance    (distância km via ORS directions)
 * - /api/calc        (cálculo + registro + retorna calc_id e pdf_url)
 * - /api/receipt/:id.pdf  (PDF sob demanda)
 *
 * Requisitos:
 * - Node >= 18 (fetch nativo)
 * - ENV: ORS_API_KEY (obrigatório)
 * - ENV: ALLOWED_ORIGINS (opcional) CSV, ex:
 *   "http://localhost:3000,https://wvehuiah.github.io"
 */

import express from "express";
import dotenv from "dotenv";
import path from "path";
import crypto from "crypto";
import cors from "cors";
import { fileURLToPath } from "url";
import { buildReceiptPdf } from "./pdf.js";

dotenv.config();

// ====== App ======
const app = express();

// ====== Paths (ESM) ======
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FRONTEND_DIR = path.join(__dirname, "../frontend");

// ====== Config ======
const PORT = Number(process.env.PORT || 3000);
const ORS_API_KEY = process.env.ORS_API_KEY;

// Para Render/GitHub Pages:
// - Você pode setar ALLOWED_ORIGINS no Render (Environment)
// - ou deixar vazio e usar mesma-origem quando servir frontend pelo backend
const DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://wvehuiah.github.io",
    "https://wvehuiah.github.io/DIO-EcoTrip",
];

const ALLOWED_ORIGINS = (() => {
    const raw = String(process.env.ALLOWED_ORIGINS || "").trim();
    if (!raw) return DEFAULT_ALLOWED_ORIGINS;
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
})();

// ====== Middlewares ======
app.use(express.json({ limit: "1mb" }));

// CORS: necessário se o frontend estiver em domínio diferente (ex.: GitHub Pages)
// Observação: se você servir o frontend via este backend (mesma origem), CORS não atrapalha.
app.use(
    cors({
        origin: (origin, cb) => {
            if (!origin) return cb(null, true); // curl/postman
            if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
            return cb(new Error(`CORS bloqueado para: ${origin}`));
        },
    })
);

// Log simples (útil em deploy)
app.use((req, res, next) => {
    const t0 = Date.now();
    res.on("finish", () => {
        const ms = Date.now() - t0;
        console.log(`${req.method} ${req.url} -> ${res.statusCode} (${ms}ms)`);
    });
    next();
});

// ====== Frontend (static) ======
app.use(express.static(FRONTEND_DIR));

// ====== Health ======
app.get("/health", (req, res) => res.json({ ok: true }));

// ====== Constantes de cálculo ======
const FACTORS = {
    bike: 0.0,
    bus: 0.089,
    car: 0.12,
    truck: 0.96,
};

const MODE_LABEL = {
    bike: "Bicicleta",
    bus: "Ônibus",
    car: "Carro",
    truck: "Caminhão",
};

const CREDIT_PRICE = { base: 45, min: 25, max: 85 };
const FACTORS_VERSION = "2025.12.26";

// Registro em memória (MVP)
const CALCS = new Map();

function newCalcId() {
    const hex = crypto.randomBytes(6).toString("hex").toUpperCase();
    return `OL-${hex}`;
}

function assertORSKey() {
    if (!ORS_API_KEY) {
        const err = new Error(
            "ORS_API_KEY ausente. Configure em backend/.env (local) ou env vars (deploy)."
        );
        err.status = 500;
        throw err;
    }
}

// ====== Helper fetch (ORS) ======
async function orsFetchJson(url, options = {}) {
    assertORSKey();

    // Monta headers de forma segura (não envie Content-Type em GET sem body)
    const baseHeaders = { Accept: "application/json", Authorization: ORS_API_KEY };
    const headers = { ...baseHeaders, ...(options.headers || {}) };

    // Se tiver body e não tiver Content-Type, assume JSON
    const hasBody = typeof options.body === "string" || options.body instanceof Uint8Array;
    if (hasBody && !headers["Content-Type"]) headers["Content-Type"] = "application/json";

    const r = await fetch(url, {
        ...options,
        headers,
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
        const msg =
            data?.error?.message ||
            data?.error ||
            data?.message ||
            `Falha ORS (${r.status})`;
        const err = new Error(msg);
        err.status = 502;
        err.details = { status: r.status, data };
        throw err;
    }

    return data;
}

// ====== Geocode (pega 1 resultado e extrai coords) ======
async function geocodeOne(text) {
    assertORSKey();

    const url = new URL("https://api.openrouteservice.org/geocode/search");
    url.searchParams.set("text", text);
    url.searchParams.set("size", "1");
    url.searchParams.set("boundary.country", "BR");

    const data = await orsFetchJson(url.toString(), { method: "GET" });

    const f = data?.features?.[0];
    const lon = f?.geometry?.coordinates?.[0];
    const lat = f?.geometry?.coordinates?.[1];

    if (typeof lon !== "number" || typeof lat !== "number") {
        const err = new Error("Não foi possível localizar a cidade informada.");
        err.status = 400;
        throw err;
    }

    return { lon, lat };
}

// ====== Suggest (autocomplete) ======
async function suggestPlaces(q, size = 6) {
    assertORSKey();

    const url = new URL("https://api.openrouteservice.org/geocode/autocomplete");
    url.searchParams.set("text", q);
    url.searchParams.set("size", String(size));
    url.searchParams.set("boundary.country", "BR");

    const data = await orsFetchJson(url.toString(), { method: "GET" });

    const features = Array.isArray(data?.features) ? data.features : [];
    return features
        .map((f) => ({
            label: f?.properties?.label,
            lon: f?.geometry?.coordinates?.[0],
            lat: f?.geometry?.coordinates?.[1],
        }))
        .filter((x) => typeof x.label === "string" && x.label.trim().length > 0)
        .slice(0, size);
}

app.get("/api/suggest", async (req, res) => {
    try {
        const q = String(req.query.q || "").trim();
        if (q.length < 3) return res.json({ suggestions: [] });

        const suggestions = await suggestPlaces(q, 6);
        return res.json({ suggestions });
    } catch (e) {
        console.error("ERRO /api/suggest:", e?.details || e);
        return res.status(e.status || 500).json({ error: e.message || "Erro interno" });
    }
});

// ====== Directions (POST JSON) ======
async function directionsDistanceKm(origin, destination, profile = "driving-car") {
    const [o, d] = await Promise.all([geocodeOne(origin), geocodeOne(destination)]);

    const safeProfile = encodeURIComponent(profile);
    const url = `https://api.openrouteservice.org/v2/directions/${safeProfile}/json`;

    const body = JSON.stringify({
        coordinates: [
            [o.lon, o.lat],
            [d.lon, d.lat],
        ],
    });

    const data = await orsFetchJson(url, { method: "POST", body });

    const meters =
        data?.routes?.[0]?.summary?.distance ??
        data?.routes?.[0]?.segments?.[0]?.distance ??
        null;

    if (typeof meters !== "number" || !isFinite(meters) || meters <= 0) {
        const err = new Error("Distância não retornada pela API (payload inesperado).");
        err.status = 502;
        err.details = { data };
        throw err;
    }

    return meters / 1000;
}

// Compat: /api/distance
app.post("/api/distance", async (req, res) => {
    try {
        const origin = String(req.body?.origin || "").trim();
        const destination = String(req.body?.destination || "").trim();
        const profile = String(req.body?.profile || "driving-car").trim();

        if (!origin || !destination) {
            return res.status(400).json({ error: "Informe origem e destino." });
        }

        const km = await directionsDistanceKm(origin, destination, profile);

        // guarda de sanidade (você já viu limites do ORS estourarem)
        if (km > 6000) {
            return res.status(400).json({
                error:
                    "Distância excede limites práticos. Verifique se você selecionou cidades válidas (não estados/países).",
            });
        }

        return res.json({ distance_km: Number(km.toFixed(2)) });
    } catch (e) {
        console.error("ERRO /api/distance:", e?.details || e);
        return res.status(e.status || 500).json({ error: e.message || "Erro interno" });
    }
});

// Principal: /api/calc
app.post("/api/calc", async (req, res) => {
    try {
        const origin = String(req.body?.origin || "").trim();
        const destination = String(req.body?.destination || "").trim();
        const transport = String(req.body?.mode || req.body?.transport || "car").trim();

        if (!origin || !destination) {
            return res.status(400).json({ error: "Informe origem e destino." });
        }

        if (!Object.prototype.hasOwnProperty.call(FACTORS, transport)) {
            return res.status(400).json({ error: "Modo de transporte inválido." });
        }

        const km = await directionsDistanceKm(origin, destination, "driving-car");

        if (km > 6000) {
            return res.status(400).json({
                error:
                    "Distância excede limites práticos. Verifique origem/destino (ex.: selecione cidade, não estado/país).",
            });
        }

        const emission = km * FACTORS[transport];
        const carEmission = km * FACTORS.car;

        const delta = emission - carEmission;
        const vsPct = carEmission > 0 ? (emission / carEmission) * 100 : 0;

        const credits = emission / 1000;
        const costBase = credits * CREDIT_PRICE.base;
        const costMin = credits * CREDIT_PRICE.min;
        const costMax = credits * CREDIT_PRICE.max;

        // registrar
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
                mode_label: MODE_LABEL[transport] || transport,
            },
            results: {
                emission_kg: Number(emission.toFixed(2)),
                car_emission_kg: Number(carEmission.toFixed(2)),
                delta_vs_car_kg: Number(delta.toFixed(2)),
                vs_car_pct: Number(vsPct.toFixed(2)),
                credits_needed: Number(credits.toFixed(4)),
                cost_base_brl: Number(costBase.toFixed(2)),
                cost_min_brl: Number(costMin.toFixed(2)),
                cost_max_brl: Number(costMax.toFixed(2)),
            },
            factors: {
                kg_per_km: { ...FACTORS },
                credit_price: { ...CREDIT_PRICE },
            },
            factorsVersion: FACTORS_VERSION,
        };

        CALCS.set(calcId, record);

        return res.json({
            calc_id: calcId,
            pdf_url: `/api/receipt/${calcId}.pdf`,
            record,
        });
    } catch (e) {
        console.error("ERRO /api/calc:", e?.details || e);
        return res.status(e.status || 500).json({ error: e.message || "Erro interno" });
    }
});

// PDF sob demanda
app.get("/api/receipt/:id.pdf", async (req, res) => {
    try {
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
            provider: record.provider,
        });

        doc.pipe(res);
        doc.end();
    } catch (e) {
        console.error("ERRO /api/receipt:", e?.details || e);
        return res.status(e.status || 500).send(e.message || "Erro ao gerar PDF.");
    }
});

// SPA fallback (evita 404 quando abrir / direto)
app.get("*", (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, "index.html"));
});

app.listen(PORT, () => console.log(`App: http://localhost:${PORT}`));
