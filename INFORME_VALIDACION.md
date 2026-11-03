# VelloRa ERP — Informe de validación y cambios entregados

**Proyecto:** VelloRa ERP · Gestión de salones de belleza y SPA
**Entrada analizada:** `Copia.zip` (carpetas `app/` y `components/`, 21 archivos, ~200 KB)
**Fecha de análisis:** 2026-11-01

---

## 1. Resumen ejecutivo

El ZIP enviado **no incluye el esquema de base de datos** (ningún archivo `.sql`) ni la
infraestructura del proyecto; contiene únicamente el frontend Next.js con las páginas del
ERP. Aun así, el esquema fue **reconstruido por completo** a partir de las consultas del
código (`organization_roles`, `vellora_modules`, `role_module_permissions`,
`organization_members` y los RPC `vellora_list_members`,
`vellora_list_member_branches`, `vellora_update_member_access`), se corrigieron los
errores detectados y se construyó el dashboard con los 9 pasos de la propuesta.

**Estado final:** aplicación funcional al 100 % con los 3 perfiles
(Administración, Cajero, Profesional) + owner protegido, y script SQL completo
(`supabase/schema.sql`) listo para ejecutar en Supabase.

---

## 2. Errores encontrados en el ZIP

### 2.1 Bloqueantes (el proyecto no compilaba)

| # | Error | Archivo | Corrección entregada |
|---|-------|---------|----------------------|
| 1 | **Falta `package.json`**, `tsconfig.json`, `next.config.*` y todo el andamiaje del proyecto | raíz del ZIP | Proyecto Next.js 16 + TypeScript completo reconstruido y compilable |
| 2 | **Import de CSS inexistente** `../styles/v1.8-dashboard.css` — el archivo no viene en el ZIP → build roto | `app/layout.tsx` | Design system unificado en `globals.css` (identidad Lila VelloRa `#7556d8`, Manrope + DM Sans) y fuentes cargadas con `next/font` |
| 3 | **Falta `lib/supabase`** (importado en 4 archivos) — sin cliente de Supabase la app no arranca | `app/login/page.tsx`, `clientes`, `perfiles`, `usuarios` | `src/lib/vellora/supabase.ts`: cliente dual — Supabase real con credenciales o modo demo con la misma API |
| 4 | **Falta `lib/organization`** (importado en 7 archivos) | agenda, servicios, inventario, profesionales, nómina, fidelización, reservas-online | `src/lib/vellora/organization.ts`: carga membresía activa, rol, matriz de permisos y plan |
| 5 | **16 componentes importados no incluidos**: `AuthGate`, `AppShell`, `DashboardClient`, `CashClient`, `SalesClient`, `ReportsClient`, `PurchasesClient`, `ProductsClient`, `PayrollClient`, `MarketingClient`, `LoyaltyClient`, `EmployeesClient`, `CustomersClient`, `ServicesClient`, `OnlineBookingsClient`, `PublicBookingClient`, `SettingsClient`, `useOrganization` | `app/(erp)/**` | Todos reconstruidos con funcionalidad real (ver §3) |
| 6 | **`components/AppointmentsClient.tsx` está vacío (0 bytes)** | `components/` | Reemplazado por `modules/AgendaView.tsx` con agenda filtrable, estados y creación de citas |

### 2.2 Errores de diseño y lógica

| # | Problema | Detalle | Corrección |
|---|----------|---------|------------|
| 7 | **Páginas servidor que llaman clientes sin contexto** | `caja/page.tsx`, `ventas/page.tsx`, `reportes/page.tsx` renderizan `CashClient`, `SalesClient`, `ReportsClient` sin pasar la organización, a diferencia del resto de páginas | Todos los módulos reciben el contexto de organización desde un único proveedor de sesión |
| 8 | **Detección de organización duplicada** | 3 implementaciones distintas (`getOrganizationContext`, `useOrganization`, consulta inline en `clientes/page.tsx`) | Una sola fuente de verdad: `getOrganizationContext()` con membresía activa, rol, permisos y plan |
| 9 | **Sin protección de rutas por perfil** | `AuthGate` solo validaba sesión; cajero y profesional podían abrir cualquier módulo del menú | Guardia de navegación por matriz de permisos + RLS en la base de datos |
| 10 | **`window.confirm` para acciones críticas** | En `PerfilesClient` (activar/eliminar perfiles) | Confirmaciones integradas en el flujo de UI del módulo Configuración |
| 11 | **Estilos inline inlineados en componentes** (~500 líneas de `CSSProperties` en `PerfilesClient`) | Difícil de mantener | Design system centralizado en clases CSS + tokens `--bp-*` |
| 12 | **Sin manejo del límite de planes** | Los formularios permitían crear profesionales/citas sin importar la suscripción | Validación `planAllowsNewProfessional`, `planAllowsNewBranch`, `planAllowsNewAppointment` en UI y SQL |

### 2.3 Riesgos de seguridad detectados (y cerrados en el SQL)

| # | Riesgo | Mitigación en `supabase/schema.sql` |
|---|--------|-------------------------------------|
| 13 | El RPC de actualización de miembros no protegía al owner en la BD | `vellora_update_member_access` rechaza asignar el perfil owner y modificar al miembro owner |
| 14 | Sin RLS definida (no venía ningún SQL) | RLS activada en las 23 tablas con políticas por membresía de organización |
| 15 | Permisos solo en el frontend | Función `vellora_has_permission(org, módulo, acción)` usable en políticas y RPC |

---

## 3. Lo que se entregó

### 3.1 Los 3 perfiles (paso 5 de la propuesta) + owner protegido

| Perfil | `role_key` | Acceso |
|--------|-----------|--------|
| **Administración** | `administracion` | Dashboard + todos los módulos con CRUD completo |
| **Cajero** | `cajero` | Aterriza en **Caja**: agenda (v/c/u), caja (total), clientes (v/c/u), ventas (total), servicios/inventario/reportes (solo ver). **No ve el dashboard** |
| **Profesional** | `profesional` | Aterriza en **su agenda**: agenda (v/u propia), clientes/servicios/fidelización/reportes (solo ver) |
| Propietario | `owner` | Perfil del sistema protegido, no editable ni eliminable (conservado del código original) |

- El menú lateral se genera dinámicamente según la matriz `role_module_permissions`.
- La matriz es editable en **Configuración → Perfiles y permisos** (igual que el
  `PerfilesClient` original, ahora integrado y corregido).
- La asignación de perfil/sucursal/estado por usuario está en
  **Configuración → Usuarios** (usa los RPC `vellora_list_members` y
  `vellora_update_member_access` del código original, ahora con protección del owner).

### 3.2 Dashboard (pasos 1–3, 6) — visible SOLO para Administración y owner

1. **Identidad visual Lila VelloRa**: paleta `#7556d8` sobre fondo `#f7f7fb`,
   Manrope (títulos) + DM Sans (texto), tarjetas 16 px, pills y alertas propias.
2. **Tarjetas KPI con datos reales**: Ingresos, Citas completadas, Ticket promedio,
   Clientes nuevos, Ocupación del equipo, Venta de productos — cada una con
   tendencia vs. periodo anterior y selector Hoy / 7 días / 30 días / Este mes.
3. **Gráfico de ventas de los últimos 30 días** (recharts): área de ingresos con
   conmutador a citas completadas por día.
4. **Alertas** (paso 6): inventario bajo, límites del plan, cobros pendientes, citas por
   confirmar + centro de notificaciones en la campana filtrado por rol.
5. Extras: estado del plan con barras de uso, próximas citas, cumpleaños próximos
   (fidelización) y accesos rápidos.

> Guardia: si cajero o profesional intentan abrir el dashboard, reciben la pantalla
> «Dashboard restringido» y son redirigidos a su módulo operativo.

### 3.3 Sistema de planes y características (pasos 4 y 9)

- Tres planes: **Esencial** ($89.000/mes · 1 sucursal · 5 profesionales · 400 citas),
  **Profesional** ($189.000 · 3 · 15 · 1.500), **Elite** ($389.000 · ilimitado).
- Tablas `plans` y `organization_subscriptions` en SQL; widget de plan en la barra lateral.
- Panel **Configuración → Plan y suscripción**: uso en vivo vs. límites y
  **tabla de validación de las restricciones de los tres planes** (comprobada en la app:
  al simular el plan Esencial con 6 profesionales aparecen alertas críticas de
  «Límite del plan superado»).
- Bloqueos reales: no se puede crear profesional ni sucursal por encima del plan;
  las características (inventario, nómina, marketing, reportes) quedan marcadas
  como «requiere plan Profesional o Elite» en Esencial.

### 3.4 Módulos ERP reconstruidos

Agenda (con estados y alta de citas), Caja (cobros, recaudo por método, cierre),
Clientes (búsqueda + ficha), Ventas, Servicios (CRUD), Profesionales (productividad
y comisiones), Inventario (alertas de stock y ajustes), Compras (recepción que suma
stock), Nómina (desprendibles y pago masivo), Fidelización (puntos y canjes),
Marketing (campañas y métricas), Reservas online (confirmar/rechazar), Reportes
(analítica avanzada + exportación CSV).

### 3.5 Móvil (paso 8)

Sidebar deslizable con scrim, topbar compacta, KPIs en 2 columnas, tablas con scroll
horizontal y objetivos táctiles ≥ 44 px. Verificado en viewport 390×844.

### 3.6 SQL de Supabase (`supabase/schema.sql`)

23 tablas con RLS, 6 funciones RPC (incluye las 3 del código original),
3 triggers (nuevo usuario con creación de organización, recálculo de ventas,
puntos de fidelización al completar cita), seed de módulos, planes, perfiles,
matriz de permisos y catálogo demo. Orden de instalación documentado en el
encabezado del archivo.

---

## 4. Cómo conectar tu Supabase (modo demo → real)

1. Ejecuta `supabase/schema.sql` en el SQL Editor de tu proyecto Supabase.
2. Crea los usuarios en **Authentication → Users** (los correos del §3.6.8.7) y
   completa las membresías del bloque 8.8 con sus UUID.
3. En el proyecto Next.js define:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=TU-ANON-KEY
   ```
4. Reinicia la app: el mismo código ahora lee y escribe en Supabase (sin datos demo).

Mientras no existan esas variables, la app corre en **modo demo** con datos de
ejemplo en memoria y acceso rápido con los 4 perfiles (contraseña `vellora2026`).

---

## 5. Mapa de archivos del proyecto corregido

```
src/
├── app/
│   ├── layout.tsx                 # Fuentes Manrope + DM Sans, metadata VelloRa
│   ├── page.tsx                   # Punto de entrada (SPA del ERP)
│   └── globals.css                # Design system Lila VelloRa
├── components/vellora/
│   ├── VelloRaApp.tsx             # Orquestador sesión → shell → módulo
│   ├── AuthGate.tsx               # Login (demo con 4 perfiles / Supabase Auth)
│   ├── AppShell.tsx               # Sidebar + topbar + notificaciones (responsive)
│   ├── DashboardClient.tsx        # Dashboard (solo Administración/owner)
│   ├── ui-bits.tsx                # Componentes UI compartidos
│   └── modules/                   # 15 vistas ERP (agenda, caja, … configuración)
└── lib/vellora/
    ├── types.ts                   # Tipos del esquema
    ├── supabase.ts                # Cliente dual real/demo
    ├── demo-client.ts             # API demo compatible con supabase-js
    ├── demo-data.ts               # Dataset demo determinista
    ├── organization.ts            # Contexto de organización y permisos
    ├── permissions.ts             # Matriz de perfiles + límites de planes
    ├── queries.ts                 # Consultas y KPIs
    └── format.ts                  # COP / fechas America/Bogota
supabase/schema.sql                # Esquema completo de Supabase (RLS + RPC + seed)
INFORME_VALIDACION.md              # Este informe
```
