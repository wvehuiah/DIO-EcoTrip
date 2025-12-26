// =====================
// Configuração (frontend apenas para UI/comparativo)
// Backend é a "fonte da verdade" para o registro e cálculo oficial.
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

const calcIdTextEl = el("calcIdText");
const receiptBtn = el("receiptBtn");

const transportWrap = el("transportWrap");
const calcBtn = el("calcBtn");
const offsetBtn = el("offsetBtn");

// datalist
const originListEl = el("originList");
const destListEl = el("destList");

// =====================
// Estado
// =====================
let selectedMode = "car";
let distanceDirty = true;

let originClearedOnce = false;
let destClearedOnce = false;

let lastCalcId = null; // para gerar recibo sob demanda

// =====================
// UI helpers
// =====================
function setLoading(btn, loading) {
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
    [...transportWrap.querySelectorAll(".transport")].forEach((btn) => {
        btn.classList.toggle("selected", btn.dataset.mode === mode);
    });
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
    lastCalcId = calcId;
    calcIdTextEl.textContent = calcId || "—";
    receiptBtn.classList.toggle("hidden", !calcId);
}

// =====================
// Limpar ao focar (1x por ciclo)
// =====================
function clearOnFirstFocus(inputEl, getSetFlag) {
    inputEl.addEventListener("focus", () => {
        if (!getSetFlag()) {
            inputEl.value = "";
            if (!manualDistanceEl.checked) {
                distanceEl.value = "";
                distanceDirty = true;
            }
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

// Reinicia flags após um cálculo bem sucedido (para o próximo ciclo)
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

    return data; // { calc_id, pdf_url, record }
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
    listEl.innerHTML = "";
    for (const s of suggestions) {
        const opt = document.createElement("option");
        opt.value = s.label;
        listEl.appendChild(opt);
    }
}

const onOriginType = debounce(async () => {
    const q = originEl.value.trim();
    if (q.length < 3) { originListEl.innerHTML = ""; return; }
    try {
        const suggestions = await fetchSuggestions(q);
        fillDatalist(originListEl, suggestions);
    } catch {}
}, 250);

const onDestType = debounce(async () => {
    const q = destEl.value.trim();
    if (q.length < 3) { destListEl.innerHTML = ""; return; }
    try {
        const suggestions = await fetchSuggestions(q);
        fillDatalist(destListEl, suggestions);
    } catch {}
}, 250);

originEl.addEventListener("input", onOriginType);
destEl.addEventListener("input", onDestType);

// =====================
// Invalidate (mudou origem/destino => distância suja)
// =====================
[originEl, destEl].forEach((input) => {
    input.addEventListener("input", () => {
        if (!manualDistanceEl.checked) {
            distanceDirty = true;
            distanceEl.value = "";
        }
        // ao mexer em origem/destino, o recibo anterior já não vale para o que está na tela
        showReceiptUI(null);
    });
});

// Se alternar manual/auto
manualDistanceEl.addEventListener("change", () => {
    const manual = manualDistanceEl.checked;
    distanceEl.disabled = !manual;

    if (!manual) {
        distanceDirty = true;
        distanceEl.value = "";
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
    routeBigEl.textContent = `${originEl.value} → ${destEl.value}`;
    distanceBigEl.textContent = `${toPtNumber(distanceKm, 2)} km`;

    const kgSel = emissionKg(selectedMode, distanceKm);
    emissionBigEl.textContent = `${toPtNumber(kgSel, 2)} kg CO₂`;
    modeSubEl.textContent = MODE_LABEL[selectedMode] ?? "—";

    const carKg = emissionKg("car", distanceKm);
    const delta = kgSel - carKg;
    const pct = carKg > 0 ? (kgSel / carKg) * 100 : 0;

    const sign = delta >= 0 ? "+" : "";
    deltaBigEl.textContent = `${sign}${toPtNumber(delta, 2)} kg`;
    deltaSubEl.textContent = `${toPtNumber(pct, 2)}% ${delta >= 0 ? "mais emissões" : "menos emissões"}`;
}

function fillCredits(distanceKm) {
    const kgSel = emissionKg(selectedMode, distanceKm);
    const credits = kgSel / 1000;

    creditsBigEl.textContent = toPtNumber(credits, 4);

    const base = credits * CREDIT_PRICE.base;
    const min = credits * CREDIT_PRICE.min;
    const max = credits * CREDIT_PRICE.max;

    costBigEl.textContent = `R$ ${toPtNumber(base, 2)}`;
    rangeSubEl.textContent = `Variação: R$ ${toPtNumber(min, 2)} - R$ ${toPtNumber(max, 2)}`;
}

// =====================
// Ação principal
// =====================
async function calculate() {
    setLoading(calcBtn, true);

    try {
        const origin = originEl.value.trim();
        const destination = destEl.value.trim();
        if (!origin || !destination) throw new Error("Informe origem e destino.");

        // Se manual, valida antes (backend ainda registra pelo /api/calc usando rota real;
        // se você quiser registrar manual no backend também, a gente abre um endpoint separado.)
        if (manualDistanceEl.checked) {
            const km = Number(distanceEl.value);
            if (!km || km <= 0) throw new Error("Distância manual inválida.");
            // Ainda assim: registra e calcula oficial via backend (rota) OU você decide registrar manual.
            // Para agora, seguimos com cálculo oficial via backend:
        }

        const data = await fetchCalc(origin, destination, selectedMode);

        // Distância oficial do backend
        const distanceKm = data.record.inputs.distance_km;
        distanceEl.value = distanceKm;
        distanceDirty = false;

        fillTopResults(distanceKm);
        fillComparatives(distanceKm);
        fillCredits(distanceKm);

        // MOSTRA o recibo sob demanda (não abre PDF)
        showReceiptUI(data.calc_id);

        // prepara próximo ciclo: ao clicar em origem/destino, limpa novamente uma vez
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
transportWrap.addEventListener("click", (e) => {
    const btn = e.target.closest(".transport");
    if (!btn) return;
    setSelectedMode(btn.dataset.mode);
});

calcBtn.addEventListener("click", calculate);

receiptBtn.addEventListener("click", () => {
    if (!lastCalcId) return;
    window.open(`/api/receipt/${lastCalcId}.pdf`, "_blank");
});

offsetBtn.addEventListener("click", () => {
    alert("Aqui você pluga checkout + registro de compensação no backend.");
});

// =====================
// Init
// =====================
distanceEl.disabled = true;
setSelectedMode(selectedMode);
showReceiptUI(null);
