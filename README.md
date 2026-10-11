# Callejero Valencia 3000

Quiz de estudio publicado con GitHub Pages. `index.html` conserva la base original,
las modificaciones locales y los perfiles Josep/Tudón.

## Móvil

El manifiesto y los iconos permiten añadir la web a la pantalla de inicio desde
el navegador compatible. El service worker está limitado a este repositorio.
Tras una primera carga online guarda la aplicación para continuar estudiando
sin conexión. Mapas, búsqueda de direcciones y sincronización necesitan internet.

## Sincronización

Utiliza el mismo proyecto y cuenta de Supabase que Calles Valencia, pero la tabla
`callejero3000_sync_state` es independiente. `supabase_setup.sql` crea la tabla,
sus tres políticas de propiedad y una función de guardado con comparación atómica
de versión. Se utiliza exclusivamente la clave pública en el navegador.

Conecta primero el ordenador que tiene los datos actuales, espera a que aparezca
«Sincronizado» y luego entra con la misma cuenta desde el móvil. No borres los
datos del navegador para hacer este paso.

Se sincronizan los dos perfiles, progreso, notas, Plan, vueltas respondidas,
fallos pendientes, salidas alternativas, revisiones confirmadas, eliminaciones,
historial, ubicaciones y preferencias. El primer acceso fusiona los datos; las
subidas simultáneas vuelven a leer si la versión ha cambiado.

Los datos del quiz y la sesión de esta aplicación se guardan en IndexedDB,
no en el pequeño localStorage compartido con los demás repositorios del dominio.
La primera carga copia las claves antiguas de Callejero 3000 en una transacción
y conserva sus originales intactos. Antes de mostrar «Sincronizado» se espera
a que termine el guardado local. Si IndexedDB falla, se avisa y no se inicia
un quiz vacío ni se presenta una sincronización como terminada.
Las copias técnicas también usan IndexedDB. «Exportar» guarda el estado
de ambos perfiles, rondas y ajustes (formato 7). Nunca incluye credenciales.

## Conservación

Las claves históricas de progreso no cambian, solo su almacenamiento. Las antiguas claves compartidas
de mapas y filtros se copian al nuevo espacio solo cuando no hay valor propio,
sin borrar el original ni escribir de nuevo sobre Calles Valencia.

Para regenerar las imágenes del icono se ejecuta `generate_icons.py` con Pillow.
Los SVG y PNG son recursos dibujados mediante código.
