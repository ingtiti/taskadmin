# Librerías de terceros (vista previa de archivos)

Copiadas tal cual desde npm para no depender de CDN externos. Se cargan solo al abrir un archivo de ese tipo.

| Carpeta | Paquete npm | Versión | Licencia | Uso |
| --- | --- | --- | --- | --- |
| `pdfjs/` | pdfjs-dist | 4.10.38 | Apache-2.0 | PDF |
| `docx-preview/` | docx-preview | 0.4.1 | Apache-2.0 | Word (.docx) |
| `jszip/` | jszip | 3.10.1 | MIT o GPL-3.0 | requerida por docx-preview |
| `exceljs/` | exceljs | 4.4.0 | MIT | Excel (.xlsx) |

Para actualizar: `npm i <paquete>@<versión>` en una carpeta aparte y copia los mismos archivos.
