# PeruanisticSPEAK 🎮🔊

Aplicación de escritorio ultraligera de comunicación por voz, chat de texto y transmisión de pantalla P2P (720p/1080p a 30 fps) optimizada para gamers con **$0 costo de infraestructura**.

Construida bajo el sistema de diseño plano de Stitch (**Flat Dark Slate Gamer Style**), sin consumos excesivos de CPU ni RAM, con atajos de teclado globales y personalizables para jugar sin interrupciones.

---

## ⚡ Características Principales

- **Audio P2P de Baja Latencia**: Negociación directa de voz con códec Opus, supresión de ruido y cancelación de eco de hardware.
- **Transmisión de Pantalla a 30 FPS**: Modos 720p y 1080p optimizados con control de bitrate para no afectar el ping en tus partidas.
- **Atajos Globales de Teclado Personalizables**:
  - `Ctrl + Shift + M`: Silenciar / Activar micrófono.
  - `Ctrl + Shift + D`: Ensordecer / Silenciar todo el sonido.
  - `Ctrl + Shift + S`: Iniciar / Detener transmisión de pantalla.
  - `F9`: Tecla para Pulsar para Hablar (Push-To-Talk).
  - *Cualquier atajo se puede reasignar en caliente desde la pestaña de Ajustes.*
- **Indicadores Reactivos de Voz**: Anillo verde esmeralda (`#23A55A`) que se ilumina al hablar.
- **$0 Costo**: Sin servidores de voz costosos (SFU). Utiliza WebRTC Mesh y servidores STUN gratuitos de Google (`stun:stun.l.google.com:19302`).

---

## 🚀 Instalación y Puesta en Marcha

### Requisitos
- **Node.js**: v18 o superior
- **Windows**: 10 u 11 (64-bit)

### Pasos
1. Clonar o abrir la carpeta del proyecto:
   ```bash
   cd PeruanisticSpeak
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Iniciar el servidor de señalización:
   ```bash
   npm run server
   ```
   *(El servidor escucha por defecto en el puerto `3001`)*

4. En otra terminal, abrir la aplicación de escritorio:
   ```bash
   npm start
   ```

---

## 🧪 Pruebas Automatizadas

Para ejecutar la suite de pruebas del servidor y del cliente WebRTC:
```bash
npm test
```

---

## 📦 Empaquetar Ejecutable Windows (.exe)

Para generar el ejecutable portable para ti y tus amigos:
```bash
npm run dist
```
El archivo ejecutable listo para usar se generará en la carpeta `dist/`.

---

## 🔒 Arquitectura y Seguridad
- **Electron Seguro**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **Preload Aislado**: Exposición mínima y controlada de APIs nativas mediante `contextBridge`.
- **Sanitización**: Mensajes de chat y nombres de usuario limitados y sanitizados contra inyección XSS.

