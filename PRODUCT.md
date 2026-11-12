# Dental Studio — contexto de producto

## Plataforma
Aplicación web responsive, Next.js 16 y React 19, utilizada principalmente en escritorio por personal de clínica odontológica en Colombia.

## Usuarios y trabajo principal
Personal de marketing y odontólogos autorizados: crear propuestas de contenido a partir de fotos, videos o guiones, revisar el contenido clínico y aprobar su publicación en Facebook e Instagram. El software no diagnostica.

## Prioridades de UX
1. Hacer evidente el flujo Crear → Revisar → Publicar.
2. Mantener una acción principal por contexto; evitar controles técnicos y duplicados.
3. Mostrar estados reales de cada red sin declarar como publicado un envío no confirmado.
4. Dar vista previa segura y clara de material clínico, sin alterar hallazgos.
5. Formularios cómodos, ayudas breves, navegación accesible, diseño responsive.

## Restricciones
No modificar en una fase visual la semántica de publicación, las credenciales, el consentimiento clínico, las rutas de API ni el esquema Prisma. No exponer imágenes sensibles ni prometer publicación exitosa sin confirmación. Mantener la compatibilidad con las propuestas existentes.

## Estado
La interfaz tiene: formulario de foto/video/guion; enfoque educativo/comercial; vista previa visual de foto 4:5; análisis opcional de imagen bajo autorización; cola de aprobación e historial; conexión Meta. Las pruebas funcionales de esta fase se mantienen pendientes por decisión del propietario.
