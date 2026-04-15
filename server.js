const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const os = require('os')
const fetch = require('node-fetch')
const AdmZip = require('adm-zip')

const app = express()
const PORT = process.env.PORT || 3333

// ── Config ────────────────────────────────────────────────────
const CFG_PATH = path.join(__dirname, 'config.json')
function loadConfig() {
  if (process.env.VERCEL) {
    return {
      github_user: process.env.GITHUB_USER || '',
      github_token: process.env.GITHUB_TOKEN || '',
      default_repo: process.env.DEFAULT_REPO || 'ar-experience'
    }
  }
  try {
    return JSON.parse(fs.readFileSync(CFG_PATH, 'utf-8'))
  } catch (e) {
    return { github_user: '', github_token: '', default_repo: 'ar-experience' }
  }
}

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

// Vercel only allows writing to /tmp
const TMP = process.env.VERCEL ? os.tmpdir() : path.join(__dirname, '_tmp')
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true })

const upload = multer({
  dest: TMP,
  limits: { fileSize: 500 * 1024 * 1024 },
})

// ── API: GET /api/status ──────────────────────────────────────
app.get('/api/status', (req, res) => {
  const cfg = loadConfig()
  res.json({
    git: true, // We don't need local git CLI anymore!
    tokenSet: !!cfg.github_token && !cfg.github_token.includes('PEGAR'),
    user: cfg.github_user,
    defaultRepo: cfg.default_repo,
    online: !!process.env.VERCEL
  })
})

// ── Helper: find index.html recursively ───────────────────────
function findIndexHtml(dir, depth = 0) {
  if (depth > 5) return null
  if (fs.existsSync(path.join(dir, 'index.html'))) return dir
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry)
      if (fs.statSync(full).isDirectory()) {
        const found = findIndexHtml(full, depth + 1)
        if (found) return found
      }
    }
  } catch (e) {}
  return null
}

// ── Helper: list files recursively ────────────────────────────
function listAll(dir, prefix = '') {
  const result = []
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry)
      const rel = prefix ? `${prefix}/${entry}` : entry
      if (fs.statSync(full).isDirectory()) {
        result.push(...listAll(full, rel))
      } else {
        result.push(rel)
      }
    }
  } catch (e) {}
  return result
}

// ── Helper: GitHub API Requests ───────────────────────────────
async function ghApi(url, token, method = 'GET', body = null) {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'AR-Publisher',
    ...(body ? { 'Content-Type': 'application/json' } : {})
  }
  const opts = { method, headers }
  if (body) opts.body = JSON.stringify(body)
  
  const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, opts)
  if (!res.ok) {
    let errText = await res.text().catch(() => '')
    throw new Error(`GitHub API Error: ${res.status} ${res.statusText} ${errText}`)
  }
  return res.json()
}

// ── API: POST /api/publish ────────────────────────────────────
app.post('/api/publish', upload.single('zip'), async (req, res) => {
  const start = Date.now()
  console.log('\n═══ PUBLISH START (API MODE) ═══')

  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' })

  const cfg = loadConfig()
  if (!cfg.github_token || cfg.github_token.includes('PEGAR')) {
    return res.status(400).json({ ok: false, error: 'Token de GitHub no configurado' })
  }

  const repoName = (req.body.repo || cfg.default_repo || 'ar-experience')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const user = cfg.github_user
  const token = cfg.github_token

  const extractDir = path.join(TMP, `pub-${Date.now()}`)
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    // 1. Extraer ZIP localmente
    console.log('  Extrayendo ZIP...')
    const zip = new AdmZip(req.file.path)
    zip.extractAllTo(extractDir, true)

    let publishDir = findIndexHtml(extractDir) || extractDir
    fs.writeFileSync(path.join(publishDir, '.nojekyll'), '') // Para GitHub Pages

    const allFiles = listAll(publishDir)
    console.log(`  Archivos a publicar: ${allFiles.length}`)

    // 2. Verificar/Crear Repositorio
    console.log(`  GitHub: verificando repo ${user}/${repoName}...`)
    try {
      await ghApi(`/repos/${user}/${repoName}`, token)
      console.log('  GitHub: repo ya existe.')
    } catch (e) {
      if (e.message.includes('404')) {
        console.log('  GitHub: creando repo...')
        await ghApi('/user/repos', token, 'POST', {
          name: repoName,
          description: 'WebAR — publicado con AR Publisher',
          private: false,
          auto_init: true
        })
        await new Promise(r => setTimeout(r, 4000))
      } else {
        throw e
      }
    }

    // 3. Subir todos los archivos como Blobs a GitHub
    console.log('  GitHub: subiendo archivos (blobs)...')
    const treeItems = []
    for (let i = 0; i < allFiles.length; i++) {
      const relPath = allFiles[i]
      const fullPath = path.join(publishDir, relPath)
      const contentBuffer = fs.readFileSync(fullPath)
      
      const blobRes = await ghApi(`/repos/${user}/${repoName}/git/blobs`, token, 'POST', {
        content: contentBuffer.toString('base64'),
        encoding: 'base64'
      })
      
      treeItems.push({
        path: relPath.replace(/\\/g, '/'),
        mode: '100644',
        type: 'blob',
        sha: blobRes.sha
      })
      if ((i + 1) % 10 === 0) console.log(`    Subidos: ${i + 1}/${allFiles.length}...`)
    }

    // 4. Crear un Tree con todos los Blobs
    console.log('  GitHub: creando árbol (tree)...')
    const treeRes = await ghApi(`/repos/${user}/${repoName}/git/trees`, token, 'POST', {
      tree: treeItems
    })

    // 5. Crear el Commit
    console.log('  GitHub: creando commit...')
    const commitRes = await ghApi(`/repos/${user}/${repoName}/git/commits`, token, 'POST', {
      message: 'Deploy AR experience via AR Publisher',
      tree: treeRes.sha
    })

    // 6. Actualizar la rama principal (main o master)
    console.log('  GitHub: actualizando rama...')
    let headRef = 'heads/main'
    try {
      // Intentar forzar update a main
      await ghApi(`/repos/${user}/${repoName}/git/refs/${headRef}`, token, 'PATCH', {
        sha: commitRes.sha,
        force: true
      })
    } catch (e) {
      if (e.message.includes('404')) {
        // Main no existe, crearla
        try {
          await ghApi(`/repos/${user}/${repoName}/git/refs`, token, 'POST', {
            ref: `refs/${headRef}`,
            sha: commitRes.sha
          })
        } catch (e2) {
          // Si falla, probar con master
          headRef = 'heads/master'
          try {
             await ghApi(`/repos/${user}/${repoName}/git/refs/${headRef}`, token, 'PATCH', { sha: commitRes.sha, force: true })
          } catch(e3) {
             await ghApi(`/repos/${user}/${repoName}/git/refs`, token, 'POST', { ref: `refs/${headRef}`, sha: commitRes.sha })
          }
        }
      } else {
        throw e
      }
    }
    console.log('  Git push exitoso (API) ✓')

    // 7. Activar GitHub Pages (reintentar)
    console.log('  GitHub: activando Pages...')
    let pagesOk = false
    const branchName = headRef.replace('heads/', '')
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await new Promise(r => setTimeout(r, attempt === 1 ? 3000 : 5000))
        const pRes = await fetch(`https://api.github.com/repos/${user}/${repoName}/pages`, {
          method: 'POST',
          headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.switcheroo-preview+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: { branch: branchName, path: '/' } })
        })
        console.log(`  Pages intento ${attempt}: status ${pRes.status}`)
        if (pRes.status === 201 || pRes.status === 409) { pagesOk = true; break }
      } catch (e) {
        console.log(`  Pages intento ${attempt} falló: ${e.message.slice(0, 80)}`)
      }
    }
    if (!pagesOk) console.log('  ⚠ Pages no se activó automáticamente. Activar manual.')

    // 8. Resultado
    const pagesUrl = `https://${user}.github.io/${repoName}/`
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=M&data=${encodeURIComponent(pagesUrl)}`
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(`═══ PUBLISH OK (${elapsed}s) ═══`)
    res.json({
      ok: true,
      url: pagesUrl,
      repo: `https://github.com/${user}/${repoName}`,
      qr: qrUrl,
      time: elapsed + 's',
    })

  } catch (err) {
    console.error('═══ PUBLISH ERROR ═══')
    console.error(err)
    res.status(500).json({ ok: false, error: err.message || err.toString() })
  } finally {
    try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch (e) {}
    try { fs.unlinkSync(req.file.path) } catch (e) {}
  }
})

// Vercel requires exporting the app, not starting a listening server directly normally,
// but for local testing we start it.
if (require.main === module) {
  app.listen(PORT, () => {
    const cfg = loadConfig()
    const tokenOk = cfg.github_token && !cfg.github_token.includes('PEGAR')
    console.log('')
    console.log('  ╔══════════════════════════════════════╗')
    console.log('  ║    AR Publisher — 100% API Mode       ║')
    console.log('  ╠══════════════════════════════════════╣')
    console.log(`  ║  http://localhost:${PORT}               ║`)
    console.log(`  ║  Token: ${tokenOk ? '✓' : '✗ FALTA'}                     ║`)
    console.log(`  ║  Usuario: ${cfg.github_user.padEnd(20)} ║`)
    console.log('  ╚══════════════════════════════════════╝')
  })
}

module.exports = app
