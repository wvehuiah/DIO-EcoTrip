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

    // Helpers
    const line = () => {
        doc.moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.width - doc.page.margins.right, doc.y)
            .strokeColor("#E5E7EB")
            .stroke();
        doc.moveDown(0.8);
    };

    const h = (txt) => {
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#0E141B").text(txt);
        doc.moveDown(0.4);
    };

    const kv = (k, v) => {
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#111827").text(k, { continued: true });
        doc.font("Helvetica").fontSize(10).fillColor("#111827").text(` ${v ?? "—"}`);
    };

    // Header
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#0FB27A").text("OLIMPUS", { align: "left" });
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text("Recibo de Cálculo de Emissões (CO₂)", { align: "left" });
    doc.moveDown(0.8);

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#111827").text(`ID do Cálculo: ${calcId}`);
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text(`Gerado em: ${new Date(createdAt).toLocaleString("pt-BR")}`);
    doc.font("Helvetica").fontSize(10).fillColor("#374151").text(`Provedor de rota: ${provider || "—"}`);
    doc.moveDown(0.8);
    line();

    // Inputs
    h("Entradas (Inputs)");
    kv("Origem:", inputs.origin);
    kv("Destino:", inputs.destination);
    kv("Distância:", `${Number(inputs.distance_km).toFixed(2)} km`);
    kv("Transporte:", inputs.mode_label);
    doc.moveDown(0.8);
    line();

    // Results
    h("Resultados");
    kv("Emissão (CO₂):", `${Number(results.emission_kg).toFixed(2)} kg`);
    kv("Referência (Carro):", `${Number(results.car_emission_kg).toFixed(2)} kg`);
    kv("Diferença vs Carro:", `${Number(results.delta_vs_car_kg).toFixed(2)} kg`);
    kv("VS Carro (%):", `${Number(results.vs_car_pct).toFixed(2)}%`);
    doc.moveDown(0.8);

    kv("Créditos necessários:", `${Number(results.credits_needed).toFixed(4)} crédito(s)`);
    kv("Custo estimado (base):", `R$ ${Number(results.cost_base_brl).toFixed(2)}`);
    kv("Faixa estimada:", `R$ ${Number(results.cost_min_brl).toFixed(2)} - R$ ${Number(results.cost_max_brl).toFixed(2)}`);
    doc.moveDown(0.8);
    line();

    // Methodology
    h("Metodologia e Fatores");
    kv("Versão dos fatores:", factorsVersion);
    doc.moveDown(0.3);

    doc.font("Helvetica").fontSize(10).fillColor("#111827")
        .text("Fatores de emissão utilizados (kg CO₂/km):");
    doc.moveDown(0.3);

    Object.entries(factors).forEach(([k, v]) => {
        doc.font("Helvetica").fontSize(10).fillColor("#111827")
            .text(`• ${k}: ${v}`);
    });

    doc.moveDown(1.0);
    doc.font("Helvetica").fontSize(9).fillColor("#6B7280")
        .text("Observação: Este recibo registra os parâmetros utilizados no cálculo e pode ser usado para auditoria interna. Em produção, recomenda-se assinar digitalmente o PDF e persistir em banco (ex.: PostgreSQL) com trilha de auditoria.");

    return doc;
}
