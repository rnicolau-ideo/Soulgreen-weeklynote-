const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS updates (
      stream   TEXT PRIMARY KEY,
      name     TEXT,
      bullets  TEXT,
      saved_at TEXT
    )
  `);
}

app.get('/updates', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM updates');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load updates' });
  }
});

app.post('/updates', async (req, res) => {
  const { stream, name, bullets, savedAt } = req.body;
  if (!stream || !bullets) {
    return res.status(400).json({ error: 'stream and bullets are required' });
  }
  try {
    await pool.query(
      `INSERT INTO updates (stream, name, bullets, saved_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (stream) DO UPDATE SET name=$2, bullets=$3, saved_at=$4`,
      [stream, name || '', bullets, savedAt || new Date().toISOString()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save update' });
  }
});

app.delete('/updates', async (req, res) => {
  try {
    await pool.query('DELETE FROM updates');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear updates' });
  }
});

// ── GitHub publish proxy ──────────────────────────────────────────────────
app.post('/publish', async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured on server' });

  const { repo, filename, content } = req.body;
  if (!repo || !filename || !content) {
    return res.status(400).json({ error: 'repo, filename and content are required' });
  }

  const apiBase = `https://api.github.com/repos/${repo}/contents/${filename}`;
  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'User-Agent': 'weeknote-tool'
  };

  let sha = null;
  try {
    const check = await fetch(apiBase, { headers });
    if (check.ok) { const d = await check.json(); sha = d.sha; }
  } catch (_) {}

  const body = { message: `Add ${filename}`, content, branch: 'main' };
  if (sha) body.sha = sha;

  try {
    const ghRes = await fetch(apiBase, { method: 'PUT', headers, body: JSON.stringify(body) });
    const data = await ghRes.json();
    if (!ghRes.ok) return res.status(ghRes.status).json({ error: data.message || 'GitHub error' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Publish failed: ' + err.message });
  }
});

init()
  .then(() => {
    const port = process.env.PORT || 3000;
    app.listen(port, () => console.log(`API listening on port ${port}`));
  })
  .catch(err => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });
