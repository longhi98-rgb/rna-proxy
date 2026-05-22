const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Abilita CORS per tutte le origini (necessario per l'artifact)
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'RNA Proxy attivo', version: '1.0' });
});

// Endpoint principale: interrogazione RNA per Codice Fiscale
app.get('/api/rna/azienda', async (req, res) => {
  const { cf } = req.query;

  if (!cf) {
    return res.status(400).json({ error: 'Parametro cf mancante' });
  }

  try {
    const rnaUrl = 'https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti';

    const body = new URLSearchParams();
    body.append('values[cfBen]', cf.toUpperCase());
    body.append('values[count]', '1');

    const response = await fetch(rnaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; RNAPlafondManager/1.0)',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.rna.gov.it',
        'Referer': 'https://www.rna.gov.it/RegistroNazionaleTrasparenza/faces/pages/TrasparenzaAiuto.jspx'
      },
      body: body.toString()
    });

    if (!response.ok) {
      return res.status(502).json({
        error: 'Errore dal portale RNA',
        status: response.status,
        statusText: response.statusText
      });
    }

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    console.error('Errore chiamata RNA:', err.message);
    return res.status(500).json({
      error: 'Errore interno del proxy',
      message: err.message
    });
  }
});

// Endpoint: dettaglio singolo aiuto (scraping pagina dettaglio)
app.get('/api/rna/dettaglio', async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: 'Parametro id mancante' });
  }

  try {
    const detailUrl = `https://www.rna.gov.it/RegistroNazionaleTrasparenza/faces/pages/dettaglioAiuto.jspx?id=${encodeURIComponent(id)}`;

    const response = await fetch(detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RNAPlafondManager/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      }
    });

    const html = await response.text();

    // Estrazione campi dalla pagina HTML del portale RNA
    const strumento = extractField(html, 'Strumento di aiuto') || '';
    const descrizione = extractField(html, 'Descrizione') || '';
    const cup = extractField(html, 'CUP') || '';
    const baseGiuridica = extractField(html, 'Base giuridica') || '';
    const regione = extractField(html, 'Regione') || '';
    const settore = extractField(html, 'Settore') || '';

    return res.json({
      id,
      strumento_aiuto: strumento,
      descrizione_aiuto: descrizione,
      cup,
      base_giuridica: baseGiuridica,
      regione,
      settore,
      link: detailUrl
    });

  } catch (err) {
    console.error('Errore scraping dettaglio:', err.message);
    return res.status(500).json({
      error: 'Errore recupero dettaglio',
      message: err.message
    });
  }
});

// Endpoint: ricerca misure RNA
app.get('/api/rna/misure', async (req, res) => {
  const { titolo, ente, regione, tipo, anno } = req.query;

  try {
    // Costruisce la chiamata all'endpoint RNA misure
    const params = new URLSearchParams();
    if (titolo) params.append('values[titolo]', titolo);
    if (ente) params.append('values[ente]', ente);
    if (regione) params.append('values[regione]', regione);
    if (tipo) params.append('values[tipo]', tipo);
    if (anno) params.append('values[anno]', anno);
    params.append('values[count]', '1');

    const response = await fetch('https://www.rna.gov.it/rna/oracle/query/trasparenza/misure', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; RNAPlafondManager/1.0)',
      },
      body: params.toString()
    });

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint: beneficiari per CAR (codice misura)
app.get('/api/rna/beneficiari', async (req, res) => {
  const { car } = req.query;

  if (!car) {
    return res.status(400).json({ error: 'Parametro car mancante' });
  }

  try {
    const params = new URLSearchParams();
    params.append('values[car]', car);
    params.append('values[count]', '1');

    const response = await fetch('https://www.rna.gov.it/rna/oracle/query/trasparenza/aiuti', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (compatible; RNAPlafondManager/1.0)',
      },
      body: params.toString()
    });

    const data = await response.json();
    return res.json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper: estrae un campo dal HTML della pagina dettaglio RNA
function extractField(html, label) {
  try {
    const regex = new RegExp(label + '[^<]*<[^>]+>([^<]+)<', 'i');
    const match = html.match(regex);
    return match ? match[1].trim() : null;
  } catch (e) {
    return null;
  }
}

app.listen(PORT, () => {
  console.log(`RNA Proxy in ascolto sulla porta ${PORT}`);
});
