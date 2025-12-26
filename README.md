# DIO – GitHub Copilot: Código na Prática

## 👤 Autor
**wvehuiah**  
🔗 GitHub: https://github.com/wvehuiah

---

## 🌱 **EcoTrip by OLIMPUS** — Calculadora de Impacto Ambiental

Projeto desenvolvido no contexto do desafio **“Calculadora EcoTrip: Simulador de Impacto Ambiental para Viagens”**, proposto pela plataforma **DIO (Digital Innovation One)**.

🔗 [**Descrição oficial do desafio**](https://web.dio.me/lab/calculadora-ecotrip-simulador-de-impacto-ambiental-para-viagens/learning/0c97038d-5595-4102-924a-eae2d11fc090)  
<sub>Obs.: O acesso ao link requer uma conta ativa na plataforma DIO.</sub>

---

## 🎯 Objetivo do Projeto

Desenvolver uma aplicação web capaz de **simular o impacto ambiental de viagens**, calculando emissões de CO₂ a partir de:

- origem e destino informados pelo usuário;
- distância calculada automaticamente via serviço de rotas;
- meio de transporte selecionado;
- fatores de emissão parametrizados.

O projeto foi concebido para ir além do requisito mínimo do desafio, incorporando:
- arquitetura frontend + backend;
- integração com API externa de rotas (OpenRouteService);
- autocomplete de localidades;
- fallback manual;
- registro de cálculos;
- geração **opcional** de recibo em PDF.

---

## 🧠 Entendendo o Desafio

A proposta original do desafio consiste em utilizar **prompts** e os conteúdos apresentados nos vídeos para construir uma calculadora de impacto ambiental.

Neste projeto, a ideia foi expandida para simular um **produto real**, adotando boas práticas de engenharia de software, UX e separação de responsabilidades.

A aplicação permite ao usuário:

- informar **origem e destino** (com sugestão automática);
- escolher o **meio de transporte** (bicicleta, carro, ônibus ou caminhão);
- calcular automaticamente a **distância da rota**;
- visualizar o impacto ambiental em **kg de CO₂**;
- comparar emissões entre diferentes meios de transporte;
- gerar, **apenas se desejar**, um **recibo/relatório em PDF** com identificação única do cálculo.

---

## 🧩 Funcionalidades Principais

- 🔎 Autocomplete de cidades (backend)
- 🛣️ Cálculo automático de distância via API de rotas
- 🔄 Fallback para entrada manual de distância
- 🚗 Comparação de emissões por tipo de transporte
- 📊 Exibição clara dos resultados em tela
- 🧾 Geração **sob demanda** de recibo em PDF
- 🧪 Registro do cálculo (inputs, fatores e versão)
- 🎨 Interface inspirada na identidade visual **OLIMPUS**

---

## 🛠️ Tecnologias Utilizadas

### Frontend
- HTML5
- CSS3
- JavaScript (Vanilla)

### Backend
- Node.js
- Express
- OpenRouteService API
- PDFKit

---

## 🔐 Segurança e Configuração

Este projeto **não expõe chaves de API no frontend ou no repositório**.

A chave do OpenRouteService deve ser configurada localmente via arquivo `.env`:

```env
ORS_API_KEY=your_api_key_here
```

>---

***Lógica de Programação | HTML | CSS | JavaScript | GitHub Copilot***
