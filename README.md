# AR Publisher — 8th Wall Companion

> Herramienta local para crear y publicar experiencias WebAR con 8th Wall Open Source.  
> Sin tocar la terminal, sin código.

## 🚀 Cómo arrancar

```bash
npm install     # Solo la primera vez
npm start       # Arranca en http://localhost:3333
```

Se abre el browser automáticamente en http://localhost:3333

---

## ✦ Crear Experiencia AR

1. Elegí el modo AR:
   - **World Tracking** — el modelo flota en el espacio real
   - **Image Target** — el modelo aparece al reconocer una imagen
2. Subí tu archivo `.glb`
3. (Si usás Image Target) subí la imagen que quieras usar como marcador
4. Dale un nombre al proyecto
5. Click **"Generar Experiencia AR"**
6. Descargá el ZIP o publicá directo a GitHub Pages

## ◎ Image Target Processor

1. Subí tu imagen (JPG/PNG, alta resolución)
2. Ponele un nombre al target
3. Click **"Procesar Image Target"**

Internamente usa `npx @8thwall/image-target-cli@latest` — no necesitás instalarlo ni saber qué es.

## ⬡ Publicar en GitHub Pages

Para publicar, necesitás:
1. **Token de GitHub** — [crealo acá](https://github.com/settings/tokens/new?description=AR+Publisher&scopes=repo,read:org) con scope `repo`
2. **Tu usuario de GitHub**
3. **Nombre para el repo** (se crea automáticamente si no existe)

El resultado es:
- URL pública: `https://tu-usuario.github.io/nombre-repo/`
- QR code listo para compartir (descargable)

---

## 🔧 Cómo funciona por dentro

```
ar-publisher/
├── server.js          ← API backend (Express)
├── public/
│   ├── index.html     ← UI principal
│   ├── style.css      ← Estilos
│   └── app.js         ← Lógica frontend
├── uploads/           ← Archivos subidos (temporal)
└── workspace/         ← Proyectos generados
    └── mi-proyecto/
        ├── index.html  ← Experiencia AR (usa engine de 8th Wall)
        ├── model.glb   ← Tu modelo 3D
        └── .nojekyll   ← Para GitHub Pages
```

### El HTML generado usa

- **Engine**: `@8thwall/engine-binary` via CDN de jsDelivr (gratis, sin account key)
- **Framework**: A-Frame 1.4.2
- **XR Extras**: `@8thwall/xrextras` (helper components)

### Para image targets, usa

```bash
npx @8thwall/image-target-cli@latest
```

---

## 📋 Próximos pasos

- [ ] Soporte para múltiples targets en una experiencia
- [ ] Preview en tiempo real del modelo en el browser
- [ ] Integración directa con el 8th Wall Desktop Studio (cuando estén más herramientas open source)
- [ ] Soporte para Netlify Deploy como alternativa a GitHub Pages

---

## 📄 Licencia

Código propio: MIT  
8th Wall Engine Binary: [licencia específica de Niantic Spatial](https://github.com/8thwall/engine/blob/main/LICENSE) (uso libre para proyectos, incluyendo comerciales)
