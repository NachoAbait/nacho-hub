# Puente de WhatsApp del bot de clientes

Distinto del puente de `bridge/whatsapp/` (ese es para leer las listas de precios de los proveedores,
en el número de la oficina). Este es para el **bot que le contesta a los clientes** — va en un
**número nuevo y separado**, a propósito: así, si WhatsApp llega a banear o desconectar este número por
ser un bot automático, no se lleva puesto el número de la oficina ni la lectura de precios.

No usa la API oficial de WhatsApp (Meta Cloud API) porque esa pide verificar el negocio ante Meta, y
hoy no tenemos los papeles para eso — se decidió arrancar así (Baileys, igual que el de proveedores) y
pasar a la API oficial más adelante si hace falta.

## Instalación

Igual que `bridge/whatsapp/` (ver su README para instalar Node si todavía no lo tenés), pero en esta
carpeta:

1. `cd ruta/a/nacho-hub/bridge/whatsapp-customer`
2. `npm install`
3. Creá el archivo `.env` acá (no se sube a git) con:
   ```
   HUB_URL=https://nacho-hub.vercel.app
   CRON_SECRET=el-secreto-que-tenés-en-Vercel
   ```
   (es el MISMO `CRON_SECRET` que ya usás en `bridge/whatsapp/.env` — no hace falta uno nuevo.)
4. `npm start`
5. Sale un QR. Con el **celular/chip NUEVO** (no el de la oficina): WhatsApp > Ajustes > Dispositivos
   vinculados > Vincular un dispositivo > escaneá el QR.

La sesión queda guardada en la carpeta `auth` de acá adentro — completamente separada de la de
`bridge/whatsapp/auth`, así que no se pisan entre sí ni comparten nada.

## Dejarlo arrancando solo

Mismo patrón que el otro puente (ver su README, sección "Dejarlo arrancando solo al iniciar sesión"),
cambiando el nombre del proceso para no pisarse con el de proveedores, por ejemplo:
```
pm2 start index.mjs --name whatsapp-customer-bridge
pm2 save
```

## Qué hace

- Lee cada mensaje que le llega a este número y se lo manda al hub (`/api/agents/customer-bot/ingest`).
  No filtra por remitente — acá no debería escribir ningún proveedor, solo clientes.
- Ignora grupos y tus propios mensajes.
- Cada 4 segundos (configurable con `OUTBOX_POLL_MS` en el `.env`) le pregunta al hub si hay respuestas
  del bot pendientes de mandar (`/api/agents/customer-bot/outbox`) y las manda por WhatsApp.
- Si se cae la conexión, reconecta solo, salvo que cierres la sesión desde el celular.
