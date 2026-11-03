# VelloRa ERP — Paquete corregido

ERP de gestión para salones de belleza y SPA (Next.js 16 + TypeScript + Supabase).

## Contenido
- `src/` — aplicación completa (dashboard, 15 módulos ERP, 3 perfiles + owner)
- `supabase/schema.sql` — esquema completo de la base de datos (tablas, RLS, RPC, planes, seed)
- `INFORME_VALIDACION.md` — errores encontrados en el ZIP original y cambios entregados
- `.env.example` — variables para conectar tu Supabase

## Arranque rápido
```bash
bun install        # o npm install
bun run dev        # http://localhost:3000
```

Sin credenciales de Supabase la app corre en **modo demo** (datos de ejemplo, contraseña
de los 4 perfiles: `vellora2026`). Para conectar tu Supabase: ejecuta
`supabase/schema.sql` y define `NEXT_PUBLIC_SUPABASE_URL` y
`NEXT_PUBLIC_SUPABASE_ANON_KEY` en `.env`.

## Perfiles demo
| Usuario | Perfil | Vista inicial |
|---|---|---|
| valentina@bellaesencia.co | Propietario (owner) | Dashboard |
| camila@bellaesencia.co | Administración | Dashboard (solo este perfil lo ve) |
| andres@bellaesencia.co | Cajero | Caja |
| laura@bellaesencia.co | Profesional | Su agenda |
