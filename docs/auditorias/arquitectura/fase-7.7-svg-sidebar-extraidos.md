# Fase 7.7 — SVG del Sidebar extraídos

## Estado previo

`Sidebar.tsx` contenía diez definiciones SVG inline junto con la navegación, la selección de negocio, la sesión y la presentación del usuario. Esto aumentaba el tamaño del componente, repetía atributos gráficos y dificultaba reutilizar o revisar los iconos como un conjunto.

## Decisión

Los SVG se trasladan a `components/icons/SidebarIcons.tsx` como componentes React tipados. Todos utilizan un contenedor compartido que define:

- `viewBox`, color y terminaciones de trazo;
- tamaño y grosor configurables;
- `aria-hidden` y `focusable=false`, porque cada icono acompaña una etiqueta textual visible.

El icono de actividad se reutiliza para Seguimiento y Métricas SaaS, conservando el diseño anterior. El icono de cierre de sesión mantiene sus 16 px y grosor de trazo 2.

## Impacto

- `Sidebar.tsx` queda concentrado en estructura y comportamiento de navegación.
- Los trazos y tamaños visibles no cambian.
- No se agregan dependencias ni una biblioteca externa de iconos.
- Se elimina el `@ts-ignore` de las secciones mediante el tipo explícito `NavSection`.

## Verificación

- prueba de política que impide volver a introducir SVG inline en `Sidebar.tsx`;
- prueba del conjunto completo de diez iconos y sus atributos de accesibilidad;
- pruebas frontend, `astro check` y build de producción.

## Fuera de alcance

- rediseño de iconos;
- cambios de navegación, permisos o selector de negocio;
- diseño responsive del Sidebar.
