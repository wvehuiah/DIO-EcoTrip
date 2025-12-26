const API_BASE =
    document.querySelector('meta[name="api-base"]')?.content?.trim() || "";

function api(path) {
    if (!API_BASE) throw new Error("API_BASE não configurado no index.html");
    return `${API_BASE}${path}`;
}

// ============
// Configuração (frontend apenas para UI/comparativo)
// Backend é a "fonte da verdade" para o registro e cálculo oficial no modo automático.
// =====================
const FACTORS_KG_PER_KM = {
    bike: 0.0,
    bus: 0.089,
    car: 0.12,
    truck: 0.96
};

const MODE_LABEL = {
    bike: "Bicicleta",
    bus: "Ônibus",
    car: "Carro",
    truck: "Caminhão"
};

const CREDIT_PRICE = { base: 45, min: 25, max: 85 };

const el = (id) => document.getElementById(id);

// =====================
// Seletores DOM
// =====================
const originEl = el("origin");
const destEl = el("dest");
const distanceEl = el("distance");
const manualDistanceEl = el("manualDistance");

const routeBigEl = el("routeBig");
const distanceBigEl = el("distanceBig");
const emissionBigEl = el("emissionBig");
const modeSubEl = el("modeSub");

const deltaBigEl = el("deltaBig");
const deltaSubEl = el("deltaSub");

const creditsBigEl = el("creditsBig");
const costBigEl = el("costBig");
const rangeSubEl = el("rangeSub");

const calcIdTextEl = el("calcIdText");   // pode ser null dependendo do seu HTML
const receiptBtn = el("receiptBtn");     // pode ser null dependendo do seu HTML

const transportWrap = el("transportWrap");
const calcBtn = el("calcBtn");
const offsetBtn = el("offsetBtn");

// datalist (autocomplete)
const originListEl = el("originList");
const destListEl = el("destList");

// =====================
// Estado
// =====================
let selectedMode = "car";
let lastCalcId = null;

let originClearedOnce = false;
let destClearedOnce = false;

// =====================
// UI helpers
// =====================
function setLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? "Calculando..." : "Calcular Emissões";
}

function toPtNumber(n, decimals = 2) {
    const f = new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
    });
    return f.format(n);
}

function emissionKg(mode, distanceKm) {
    return distanceKm * (FACTORS_KG_PER_KM[mode] ?? 0);
}

function setSelectedMode(mode) {
    selectedMode = mode;

    if (transportWrap) {
        [...transportWrap.querySelectorAll(".transport")].forEach((btn) => {
            btn.classList.toggle("selected", btn.dataset.mode === mode);
        });
    }

    updateSelectedBadges();
}

function updateSelectedBadges() {
    document.querySelectorAll(".compare-item").forEach((card) => {
        const isSel = card.dataset.compare === selectedMode;
        card.classList.toggle("selected", isSel);
        const badge = card.querySelector("[data-selected-badge]");
        if (badge) badge.classList.toggle("hidden", !isSel);
    });
}

function showReceiptUI(calcId) {
    lastCalcId = calcId || null;

    if (calcIdTextEl) calcIdTextEl.textContent = calcId || "—";
    if (receiptBtn) receiptBtn.classList.toggle("hidden", !calcId);
}

// =====================
// Limpar ao focar (1x por ciclo)
// =====================
function clearOnFirstFocus(inputEl, getSetFlag) {
    if (!inputEl) return;

    inputEl.addEventListener("focus", () => {
        if (!getSetFlag()) {
            inputEl.value = "";

            // ao iniciar uma nova entrada, “zera” a distância automática
            if (!manualDistanceEl?.checked && distanceEl) {
                distanceEl.value = "";
            }

            // recibo anterior não vale mais
            showReceiptUI(null);

            getSetFlag(true);
        }
    });
}

clearOnFirstFocus(originEl, (v) => {
    if (typeof v === "boolean") originClearedOnce = v;
    return originClearedOnce;
});

clearOnFirstFocus(destEl, (v) => {
    if (typeof v === "boolean") destClearedOnce = v;
    return destClearedOnce;
});

function resetClearFlags() {
    originClearedOnce = false;
    destClearedOnce = false;
}

// =====================
// API: Cálculo oficial + registro (SEM PDF automático)
// =====================
async function fetchCalc(origin, destination, mode) {
    const res = await fetch("/api/calc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin, destination, mode })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Falha ao calcular.");

    return data; // { calc_id, record }
}

// =====================
// Autocomplete (ORS via backend)
// =====================
function debounce(fn, delay = 250) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), delay);
    };
}

async function fetchSuggestions(q) {
    const res = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Falha ao buscar sugestões.");
    return Array.isArray(data?.suggestions) ? data.suggestions : [];
}

function fillDatalist(listEl, suggestions) {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const s of suggestions) {
        const opt = document.createElement("option");
        opt.value = s.label;
        listEl.appendChild(opt);
    }
}

const onOriginType = debounce(async () => {
    if (!originEl) return;
    const q = originEl.value.trim();
    if (!originListEl) return;
    if (q.length < 3) { originListEl.innerHTML = ""; return; }
    try {
        const suggestions = await fetchSuggestions(q);
        fillDatalist(originListEl, suggestions);
    } catch {
        // silencioso por UX (rede instável)
    }
}, 250);

const onDestType = debounce(async () => {
    if (!destEl) return;
    const q = destEl.value.trim();
    if (!destListEl) return;
    if (q.length < 3) { destListEl.innerHTML = ""; return; }
    try {
        const suggestions = await fetchSuggestions(q);
        fillDatalist(destListEl, suggestions);
    } catch {
        // silencioso por UX (rede instável)
    }
}, 250);

originEl?.addEventListener("input", onOriginType);
destEl?.addEventListener("input", onDestType);

// =====================
// Invalidate: ao mudar origem/destino, zera distância automática e recibo
// =====================
[originEl, destEl].forEach((input) => {
    if (!input) return;

    input.addEventListener("input", () => {
        // distância automática fica “suja”
        if (!manualDistanceEl?.checked && distanceEl) {
            distanceEl.value = "";
        }
        showReceiptUI(null);
    });
});

// alternância manual/auto
manualDistanceEl?.addEventListener("change", () => {
    const manual = manualDistanceEl.checked;
    if (distanceEl) distanceEl.disabled = !manual;

    // Se voltar para automático, zera distância e recibo
    if (!manual && distanceEl) {
        distanceEl.value = "";
        showReceiptUI(null);
    }
});

// =====================
// Render
// =====================
function fillComparatives(distanceKm) {
    const carKg = emissionKg("car", distanceKm);

    document.querySelectorAll(".compare-item").forEach((card) => {
        const mode = card.dataset.compare;
        const kg = emissionKg(mode, distanceKm);

        const emissionEl = card.querySelector("[data-emission]");
        const vsEl = card.querySelector("[data-vs]");
        const bar = card.querySelector(".bar > div");

        if (emissionEl) emissionEl.textContent = `${toPtNumber(kg, 2)} kg CO₂`;

        let vsPct = carKg > 0 ? (kg / carKg) * 100 : 0;
        if (!isFinite(vsPct)) vsPct = 0;
        if (vsEl) vsEl.textContent = `${toPtNumber(vsPct, 2)}%`;

        const capped = Math.min(vsPct, 800);
        if (bar) bar.style.width = `${(capped / 800) * 100}%`;
    });

    updateSelectedBadges();
}

function fillTopResults(distanceKm) {
    if (routeBigEl) routeBigEl.textContent = `${originEl?.value || "—"} → ${destEl?.value || "—"}`;
    if (distanceBigEl) distanceBigEl.textContent = `${toPtNumber(distanceKm, 2)} km`;

    const kgSel = emissionKg(selectedMode, distanceKm);
    if (emissionBigEl) emissionBigEl.textContent = `${toPtNumber(kgSel, 2)} kg CO₂`;
    if (modeSubEl) modeSubEl.textContent = MODE_LABEL[selectedMode] ?? "—";

    const carKg = emissionKg("car", distanceKm);
    const delta = kgSel - carKg;
    const pct = carKg > 0 ? (kgSel / carKg) * 100 : 0;

    const sign = delta >= 0 ? "+" : "";
    if (deltaBigEl) deltaBigEl.textContent = `${sign}${toPtNumber(delta, 2)} kg`;
    if (deltaSubEl) deltaSubEl.textContent =
        `${toPtNumber(pct, 2)}% ${delta >= 0 ? "mais emissões" : "menos emissões"}`;
}

function fillCredits(distanceKm) {
    const kgSel = emissionKg(selectedMode, distanceKm);
    const credits = kgSel / 1000;

    if (creditsBigEl) creditsBigEl.textContent = toPtNumber(credits, 4);

    const base = credits * CREDIT_PRICE.base;
    const min = credits * CREDIT_PRICE.min;
    const max = credits * CREDIT_PRICE.max;

    if (costBigEl) costBigEl.textContent = `R$ ${toPtNumber(base, 2)}`;
    if (rangeSubEl) rangeSubEl.textContent =
        `Variação: R$ ${toPtNumber(min, 2)} - R$ ${toPtNumber(max, 2)}`;
}

// =====================
// Ação principal
// =====================
async function calculate() {
    setLoading(calcBtn, true);

    try {
        const origin = originEl?.value?.trim() || "";
        const destination = destEl?.value?.trim() || "";

        if (!origin || !destination) throw new Error("Informe origem e destino.");

        // =====================
        // Modo MANUAL: cálculo só no frontend (sem registro oficial)
        // =====================
        if (manualDistanceEl?.checked) {
            const km = Number(distanceEl?.value);
            if (!km || km <= 0) throw new Error("Distância manual inválida.");

            // Atualiza UI com o valor manual
            fillTopResults(km);
            fillComparatives(km);
            fillCredits(km);

            // Sem recibo: não houve registro no backend
            showReceiptUI(null);

            // prepara próximo ciclo de limpeza ao focar
            resetClearFlags();
            return;
        }

        // =====================
        // Modo AUTOMÁTICO: cálculo oficial + registro via backend
        // =====================
        const data = await fetchCalc(origin, destination, selectedMode);

        const distanceKm = data?.record?.inputs?.distance_km;
        if (typeof distanceKm !== "number" || !isFinite(distanceKm) || distanceKm <= 0) {
            throw new Error("Distância inválida retornada pelo backend.");
        }

        if (distanceEl) distanceEl.value = distanceKm;

        fillTopResults(distanceKm);
        fillComparatives(distanceKm);
        fillCredits(distanceKm);

        // habilita recibo sob demanda
        showReceiptUI(data?.calc_id || null);

        // prepara próximo ciclo: ao focar, limpa novamente uma vez
        resetClearFlags();

    } catch (err) {
        alert(err?.message || "Erro ao calcular.");
    } finally {
        setLoading(calcBtn, false);
    }
}

// =====================
// Eventos UI
// =====================
transportWrap?.addEventListener("click", (e) => {
    const btn = e.target.closest(".transport");
    if (!btn) return;
    setSelectedMode(btn.dataset.mode);
});

calcBtn?.addEventListener("click", calculate);

receiptBtn?.addEventListener("click", () => {
    if (!lastCalcId) return;
    window.open(`/api/receipt/${lastCalcId}.pdf`, "_blank");
});

offsetBtn?.addEventListener("click", () => {
    alert("Aqui você pluga checkout + registro de compensação no backend.");
});

// =====================
// Init
// =====================
if (distanceEl) distanceEl.disabled = true;
setSelectedMode(selectedMode);
showReceiptUI(null);
