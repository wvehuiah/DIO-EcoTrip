import PDFDocument from "pdfkit";

export function buildReceiptPdf({
                                    calcId,
                                    createdAt,
                                    inputs,
                                    results,
                                    factors,
                                    factorsVersion,
                                    provider
                                }) {
    const doc = new PDFDocument({ size: "A4", margin: 48 });

    // ========= Helpers =========
    const line = () => {
        doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor("#E5E7EB")
            .lineWidth(1)
            .stroke();
        doc.moveDown(0.8);
    };

    const h = (txt) => {
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#0E141B").text(txt);
        doc.moveDown(0.4);
    };

    // ✅ KV com espaçamento garantido
    const kv = (k, v) => {
        const value = (v === undefined || v === null || v === "") ? "—" : String(v);
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(`${k}: `, { continued: true });
        doc.font("Helvetica").fontSize(10).fillColor("#111827").text(value);
    };

    const fmt2 = (n) => Number(n || 0).toFixed(2);
    const fmt4 = (n) => Number(n || 0).toFixed(4);

    // ✅ imprime objetos em bullets (sem [object Object])
    const bullets = (label, obj, { indent = 0 } = {}) => {
        const pad = " ".repeat(indent);

        if (!obj || typeof obj !== "object") {
            doc.font("Helvetica").fontSize(10).fillColor("#111827").text(`${pad}• ${label}: ${obj ?? "—"}`);
            return;
        }

        doc.font("Helvetica").fontSize(10).fillColor("#111827").text(`${pad}• ${label}:`);
        for (const [k, v] of Object.entries(obj)) {
            if (v && typeof v === "object") {
                bullets(k, v, { indent: indent + 2 });
            } else {
                doc.font("Helvetica").fontSize(10).fillColor("#111827").text(`${" ".repeat(indent + 2)}- ${k}: ${v}`);
            }
        }
    };

    // ========= Header =========
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0FB27A").text("OLIMPUS", { align: "left" });
    doc.font("Helvetica").fontSize(11).fillColor("#334155").text("Recibo de Cálculo de Emissões (CO2)");
    doc.moveDown(0.8);

    const ts = createdAt ? new Date(createdAt) : new Date();
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0E141B").text(`ID do Cálculo: ${calcId}`);
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text(`Gerado em: ${ts.toLocaleString("pt-BR")}`);
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text(`Provedor de rota: ${provider || "—"}`);
    doc.moveDown(0.8);
    line();

    // ========= Inputs =========
    h("Entradas (Inputs)");
    kv("Origem", inputs?.origin);
    kv("Destino", inputs?.destination);
    kv("Distância", `${fmt2(inputs?.distance_km)} km`);
    kv("Transporte", inputs?.mode_label || inputs?.mode || "—");
    doc.moveDown(0.8);
    line();

    // ========= Results =========
    h("Resultados");
    kv("Emissão (CO2)", `${fmt2(results?.emission_kg)} kg`);
    kv("Referência (Carro)", `${fmt2(results?.car_emission_kg)} kg`);
    kv("Diferença vs Carro", `${fmt2(results?.delta_vs_car_kg)} kg`);
    kv("VS Carro (%)", `${fmt2(results?.vs_car_pct)}%`);
    doc.moveDown(0.8);

    kv("Créditos necessários", `${fmt4(results?.credits_needed)} crédito(s)`);
    kv("Custo estimado (base)", `R$ ${fmt2(results?.cost_base_brl)}`);
    kv("Faixa estimada", `R$ ${fmt2(results?.cost_min_brl)} - R$ ${fmt2(results?.cost_max_brl)}`);
    doc.moveDown(0.8);
    line();

    // ========= Methodology =========
    h("Metodologia e Fatores");
    kv("Versão dos fatores", factorsVersion || "—");
    doc.font("Helvetica").fontSize(10).fillColor("#111827").text("Fatores de emissão utilizados (kg CO2/km):");
    doc.moveDown(0.3);

    // Esperado: factors = { kg_per_km: {...}, credit_price: {...} }
    if (factors && typeof factors === "object") {
        if (factors.kg_per_km) bullets("kg_per_km", factors.kg_per_km);
        if (factors.credit_price) bullets("credit_price", factors.credit_price);

        // fallback: se vier mais coisa
        for (const k of Object.keys(factors)) {
            if (k !== "kg_per_km" && k !== "credit_price") bullets(k, factors[k]);
        }
    } else {
        doc.font("Helvetica").fontSize(10).fillColor("#111827").text("• —");
    }

    doc.moveDown(1.0);
    doc.font("Helvetica").fontSize(9).fillColor("#6B7280").text(
        "Observação: Este recibo registra os parâmetros utilizados no cálculo e pode ser usado para auditoria interna. " +
        "Em produção, recomenda-se assinar digitalmente o PDF e persistir em banco (ex.: PostgreSQL) com trilha de auditoria."
    );

    return doc;
}
