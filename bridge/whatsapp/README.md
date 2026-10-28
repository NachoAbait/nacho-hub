# Puente de WhatsApp para NACHO Hub

Deja la computadora escuchando el WhatsApp del negocio y le manda al hub las listas de precios de tus proveedores.
No se instala en la app web: es un paquete aparte que corre en la Mac (o la PC) del local.

## Paso 0 (el más importante): cargar los proveedores en el panel

Este WhatsApp recibe de todo, también consultas de clientes. **El puente solo reenvía y el hub solo procesa los números
que vos cargaste como proveedores.** Cualquier otro remitente se ignora en silencio y no se guarda nada.

**Antes de que lleguen las listas, abrí https://nacho-hub.vercel.app, tocá al agente Lucas (Price Reader) y, en el
recuadro "Proveedores", pegá un número por línea con código de país y sin el +** (por ejemplo `5492257123456, Mayorista Uno`)
**y tocá Guardar.** Si no cargás los números, el agente no va a procesar nada, aunque el puente esté andando.
Ahí mismo podés ponerle a cada proveedor su descuento por unidad y notas.

## Instalación (Mac)

1. Instalá Node 20 o más nuevo: bajalo de https://nodejs.org (versión LTS) o con `brew install node`.
2. Abrí Terminal y entrá a la carpeta: `cd ruta/a/nacho-hub/bridge/whatsapp`
3. `npm install`
4. Creá a mano el archivo `.env` en esta carpeta (no se sube a git) con estas dos líneas:
   ```
   HUB_URL=https://nacho-hub.vercel.app
   CRON_SECRET=el-secreto-que-tenés-en-Vercel
   ```
5. `npm start`
6. Aparece un QR en la terminal. En el celular del negocio: WhatsApp > Ajustes > **Dispositivos vinculados** >
   Vincular un dispositivo > escaneá el QR. Cuando diga "Conectado a WhatsApp" quedó listo.

La sesión se guarda en la carpeta `auth`: la próxima vez no hace falta escanear de nuevo. Si desvinculás el dispositivo
desde el celular, borrá la carpeta `auth` y volvé a correr `npm start`.

## Instalación (Windows)

1. Instalá Node LTS desde https://nodejs.org (instalador .msi, dejá todo por defecto).
2. Abrí PowerShell o el Símbolo del sistema y entrá a la carpeta: `cd C:\ruta\a\nacho-hub\bridge\whatsapp`
3. `npm install`
4. Creá el archivo `.env` (Bloc de notas, guardalo como `.env` y no `.env.txt`) con `HUB_URL` y `CRON_SECRET` como arriba.
5. `npm start` y escaneá el QR igual que en Mac.

## Dejarlo arrancando solo al iniciar sesión

Con pm2 (Mac y Windows):
```
npm install -g pm2
pm2 start index.mjs --name whatsapp-hub
pm2 save
```
- Mac: `pm2 startup` te imprime un comando; copialo y ejecutalo. Con eso arranca al iniciar la Mac.
- Windows: `npm install -g pm2-windows-startup`, después `pm2-startup install` y `pm2 save`.

Ver lo que hace: `pm2 logs whatsapp-hub`. Primera vez con pm2: corré antes `npm start` una vez para escanear el QR
y cortalo con Ctrl+C; después arrancalo con pm2.

Alternativa en Mac sin pm2 (launchd): creá `~/Library/LaunchAgents/com.nachohub.whatsapp.plist` con `ProgramArguments`
= `/usr/local/bin/node` (o `/opt/homebrew/bin/node`) y la ruta completa a `index.mjs`, `WorkingDirectory` = esta carpeta,
`RunAtLoad` y `KeepAlive` en `true`, y cargalo con `launchctl load ~/Library/LaunchAgents/com.nachohub.whatsapp.plist`.

## Qué hace y qué no

- Ignora tus propios mensajes, los grupos y los estados.
- Lee texto de mensajes, respuestas y epígrafes de imagen. Las listas en imagen sin texto no se leen: pegalas a mano en el panel.
- Manda al hub cada mensaje; el hub decide si el número es un proveedor cargado. Las difusiones se marcan como señal extra,
  pero nunca alcanzan por sí solas.
- Si se cae la conexión, reconecta solo, salvo que cierres la sesión desde el celular.
- Los mensajes que llegan con la computadora apagada se descargan al volver a conectar, pero conviene dejarla prendida de 8:00 a 10:30.
