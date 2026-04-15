const express = require('express')
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { spawnSync } = require('child_process')
const fetch = require('node-fetch')
const AdmZip = require('adm-zip')

const app = express()
const PORT = 3333

// ── Config ────────────────────────────────────────────────────
const CFG_PATH = path.join(__dirname, 'config.json')
function loadConfig() {
  return JSON.parse(fs.readFileSync(CFG_PATH, 'utf-8'))
}

// ── Git ───────────────────────────────────────────────────────
const GIT = [
  'C:\\Users\\Mami\\AppData\\Local\\GitHubDesktop\\app-3.5.5\\resources\\app\\git\\cmd\\git.exe',
  'C:\\Program Files\\Git\\cmd\\git.exe',
].find(p => fs.existsSync(p)) || null

function git(args, cwd) {
  if (!GIT) throw new Error('git.exe no encontrado')
  console.log(`  [git] ${args.join(' ')}`)
  const r = spawnSync(GIT, args, {
    cwd, encoding: 'utf-8', timeout: 600000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (r.error) throw r.error
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || '').trim()
    console.log(`  [git] ERROR: ${msg.slice(0, 200)}`)
    throw new Error(msg.slice(0, 300))
  }
  return (r.stdout || '').trim()
}

// ── Middleware ─────────────────────────────────────────────────
app.use(express.json())
app.use(express.static(path.join(__dirname, 'public')))

const TMP = path.join(__dirname, '_tmp')
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP)

const upload = multer({
  dest: TMP,
  limits: { fileSize: 500 * 1024 * 1024 },
})

// ── API: GET /api/status ──────────────────────────────────────
app.get('/api/status', (req, res) => {
  const cfg = loadConfig()
  res.json({
    git: !!GIT,
    tokenSet: cfg.github_token && !cfg.github_token.includes('PEGAR'),
    user: cfg.github_user,
    defaultRepo: cfg.default_repo,
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

// ── API: POST /api/publish ────────────────────────────────────
app.post('/api/publish', upload.single('zip'), async (req, res) => {
  const start = Date.now()
  console.log('\n═══ PUBLISH START ═══')

  if (!req.file) return res.status(400).json({ ok: false, error: 'No se recibió archivo' })
  console.log('  Archivo recibido:', req.file.originalname, `(${(req.file.size/1024).toFixed(0)} KB)`)

  const cfg = loadConfig()
  if (!cfg.github_token || cfg.github_token.includes('PEGAR')) {
    return res.status(400).json({ ok: false, error: 'Editá config.json con tu GitHub token' })
  }

  const repoName = (req.body.repo || cfg.default_repo || 'ar-experience')
    .toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const user = cfg.github_user
  const token = cfg.github_token

  const extractDir = path.join(TMP, `pub-${Date.now()}`)
  fs.mkdirSync(extractDir, { recursive: true })

  try {
    // 1. Descomprimir ZIP con adm-zip (no depende de PowerShell)
    console.log('  Extrayendo ZIP...')
    const zip = new AdmZip(req.file.path)
    zip.extractAllTo(extractDir, true)

    const allFiles = listAll(extractDir)
    console.log(`  Archivos extraídos: ${allFiles.length}`)
    allFiles.slice(0, 15).forEach(f => console.log(`    ${f}`))
    if (allFiles.length > 15) console.log(`    ... y ${allFiles.length - 15} más`)

    if (allFiles.length === 0) {
      throw new Error('El ZIP está vacío o no se pudo extraer')
    }

    // 2. Encontrar dónde está el index.html
    let publishDir = findIndexHtml(extractDir)
    if (!publishDir) {
      console.log('  ⚠ No se encontró index.html, publicando la raíz del ZIP')
      // Si no hay index.html, usar la carpeta raíz igualmente
      publishDir = extractDir
      // Si hay una sola subcarpeta, entrar ahí
      const entries = fs.readdirSync(extractDir).filter(e => !e.startsWith('.'))
      if (entries.length === 1 && fs.statSync(path.join(extractDir, entries[0])).isDirectory()) {
        publishDir = path.join(extractDir, entries[0])
      }
    }
    console.log('  Publish dir:', publishDir)
    console.log('  Contenido:', fs.readdirSync(publishDir).join(', '))

    // .nojekyll para GitHub Pages
    fs.writeFileSync(path.join(publishDir, '.nojekyll'), '')

    // 3. GitHub: crear repo si no existe
    console.log(`  GitHub: verificando repo ${user}/${repoName}...`)
    const headers = {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'AR-Publisher',
    }

    const checkRes = await fetch(`https://api.github.com/repos/${user}/${repoName}`, { headers })
    if (!checkRes.ok) {
      console.log('  GitHub: creando repo...')
      const createRes = await fetch('https://api.github.com/user/repos', {
        method: 'POST', headers,
        body: JSON.stringify({
          name: repoName,
          description: 'WebAR — publicado con AR Publisher',
          private: false,
        }),
      })
      if (!createRes.ok) {
        const err = await createRes.json()
        throw new Error(`No se pudo crear repo: ${err.message || JSON.stringify(err)}`)
      }
      console.log('  GitHub: repo creado, esperando propagación...')
      await new Promise(r => setTimeout(r, 3000))
    } else {
      console.log('  GitHub: repo ya existe, actualizando...')
    }

    // 4. Git init + commit + push
    const remote = `https://${token}@github.com/${user}/${repoName}.git`

    // Si ya hay .git de un intento anterior, borrarlo
    const dotGit = path.join(publishDir, '.git')
    if (fs.existsSync(dotGit)) {
      fs.rmSync(dotGit, { recursive: true, force: true })
    }

    git(['init'], publishDir)
    git(['config', 'user.email', 'ar@publisher.local'], publishDir)
    git(['config', 'user.name', 'AR Publisher'], publishDir)
    git(['checkout', '-b', 'main'], publishDir)
    git(['add', '--all'], publishDir)

    // Verificar que hay archivos staged
    const status = git(['status', '--short'], publishDir)
    console.log(`  Git status: ${status.split('\n').length} archivos staged`)

    git(['commit', '-m', 'Deploy AR experience'], publishDir)
    git(['remote', 'add', 'origin', remote], publishDir)

    console.log('  Git: pushing...')
    git(['push', '-u', 'origin', 'main', '--force'], publishDir)
    console.log('  Git: push exitoso ✓')

    // 5. Activar GitHub Pages (reintentar hasta 3 veces con delay)
    console.log('  GitHub: activando Pages...')
    let pagesOk = false
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Esperar antes de intentar (GitHub necesita tiempo después del push)
        await new Promise(r => setTimeout(r, attempt === 1 ? 3000 : 5000))
        const pagesRes = await fetch(`https://api.github.com/repos/${user}/${repoName}/pages`, {
          method: 'POST',
          headers: { ...headers, Accept: 'application/vnd.github.switcheroo-preview+json' },
          body: JSON.stringify({ source: { branch: 'main', path: '/' } }),
        })
        console.log(`  Pages intento ${attempt}: status ${pagesRes.status}`)
        if (pagesRes.status === 201 || pagesRes.status === 409) { pagesOk = true; break }
      } catch (e) {
        console.log(`  Pages intento ${attempt} falló: ${e.message.slice(0, 80)}`)
      }
    }
    if (!pagesOk) console.log('  ⚠ Pages no se activó automáticamente. Activar manual: github.com/' + user + '/' + repoName + '/settings/pages')

    // 6. Resultado
    const pagesUrl = `https://${user}.github.io/${repoName}/`
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&ecc=M&data=${encodeURIComponent(pagesUrl)}`
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    console.log(`═══ PUBLISH OK (${elapsed}s) ═══`)
    console.log(`  URL: ${pagesUrl}`)
    console.log(`  Repo: https://github.com/${user}/${repoName}\n`)

    res.json({
      ok: true,
      url: pagesUrl,
      repo: `https://github.com/${user}/${repoName}`,
      qr: qrUrl,
      time: elapsed + 's',
    })

  } catch (err) {
    console.error('═══ PUBLISH ERROR ═══')
    console.error(' ', err.message)
    console.error('')
    res.status(500).json({ ok: false, error: err.message })
  } finally {
    try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch (e) {}
    try { fs.unlinkSync(req.file.path) } catch (e) {}
  }
})

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  const cfg = loadConfig()
  const tokenOk = cfg.github_token && !cfg.github_token.includes('PEGAR')
  console.log('')
  console.log('  ╔══════════════════════════════════════╗')
  console.log('  ║       AR Publisher — listo            ║')
  console.log('  ╠══════════════════════════════════════╣')
  console.log(`  ║  http://localhost:${PORT}               ║`)
  console.log(`  ║  Git: ${GIT ? '✓' : '✗ NO ENCONTRADO'}`)
  console.log(`  ║  Token: ${tokenOk ? '✓' : '✗ FALTA'}`)
  console.log(`  ║  Usuario: ${cfg.github_user}`)
  console.log('  ╚══════════════════════════════════════╝')
  console.log('')
})
