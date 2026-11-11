# Proveedores de DNI y cupos

Fuentes públicas revisadas el 11 de noviembre de 2026. El orden es una propuesta inicial según la cobertura que publica cada proveedor, la procedencia de los datos y el formato de sus respuestas. No se midieron disponibilidad, latencia ni coincidencias con datos reales. Revisa los términos y la procedencia antes de activar cada cuenta. Usa una cuenta por proveedor.

| Prioridad | Proveedor | Consultas gratis recurrentes | Condiciones |
| --- | --- | ---: | --- |
| 1 | [APISPERU](https://apisperu.com/servicios/dniruc) | 1.000/mes | La página anuncia un primer mes ilimitado. Confirma elegibilidad, fecha de vencimiento, límites y que la cuenta vuelva al plan gratis antes de activar la promoción. [Contrato HTTP](https://dniruc.apisperu.com/doc/swagger). |
| 2 | [Intifact](https://docs.intifact.com/docs/consultas/pricing) | 100/mes | 30/min. Usa la API key de Consultas. [Contrato DNI](https://docs.intifact.com/docs/consultas/dni). |
| 3 | [Factiliza](https://factiliza.com/api-consulta) | 100/mes | Cuota de API Consulta. [Contrato DNI](https://docs.factiliza.com/api-consulta/endpoint/dni). |
| 4 | [Perú API (.com)](https://peruapi.com/precios) | 1.000/mes | 50/día, 10/min, una IP autorizada. El mes sigue el ciclo de la cuenta. [Contrato HTTP](https://peruapi.com/documentacion). |
| 5 | [PerúAPI (.net)](https://peruapi.net/docs) | 50/mes | 60/min. Usa el padrón SUNAT y un proveedor externo. Se acepta el resultado solo si el proveedor marca exacta la separación de nombres y apellidos. |
| | **Total nominal** | **2.250/mes** | Si todos están activos; hasta **1.300 en un día** por el límite diario de .com, antes de descontar consultas fallidas, consumo previo y otras restricciones. |

Una consulta consumida no garantiza una persona encontrada. Los proveedores pueden compartir fuentes, responder sin coincidencia o descontar los intentos que fallen. La cuota local cuenta todos los intentos de forma conservadora; usa llaves dedicadas y verifica el saldo en el panel. Si otro sistema comparte una cuenta, solo el proveedor controla el saldo global. [Apis.net.pe migró a Decolecta](https://apis.net.pe/); no se contaron como dos proveedores ni se asumió un cupo de DNI sin publicación verificable.

## Lote inicial de 10.000

El primer mes de APISPERU es la única vía gratuita verificada públicamente entre los adaptadores para ese volumen en un ciclo. La promoción no viene activada. Confirma en el panel que esté disponible para esa cuenta y añade a la entrada de APISPERU los campos `promotionUntil` (vencimiento ISO 8601 con zona horaria) y `promotionLimit` (p. ej. `10000` intentos). Pasado el vencimiento, se vuelve automáticamente al límite local normal. Si la meta es 10.000 resultados válidos, habrá que presupuestar intentos adicionales y medir la cobertura con datos autorizados.

El límite interno de APISPERU por defecto es 120/min; se trata de un techo local conservador, no de una cuota publicada ni de una garantía del proveedor. Para un lote, reparte las altas en el tiempo y aplica backoff a la lectura de estados: 10.000 intentos a ese ritmo toman al menos unos 84 minutos, sin incluir fallos y reintentos. El servicio difiere temporalmente los trabajos si todos los candidatos están limitados en el corto plazo. Si no hay promoción, las opciones documentadas son repartir el volumen entre ciclos o evaluar un plan de pago (por ejemplo, [Factiliza anuncia 10.000 consultas por S/15/mes más IGV](https://factiliza.com/)). El código de este proyecto aplica techos de plan gratuito; no activa planes de pago.

## Alta y configuración

| Proveedor | Registro | Paso pendiente |
| --- | --- | --- |
| APISPERU | [Alta](https://apisperu.com/admin/register) | Contraseña, reCAPTCHA y envío. Verificar si el panel ofrece la promoción. |
| Intifact | [Alta](https://intifact.com/empezar) | Contraseña, código por correo y ficha del negocio. Generar la llave de Consultas. |
| Factiliza | [Alta](https://app.factiliza.com/registro) | Código enviado a `sleon@sperant.com`; ingresar el código (o reenviarlo si venció) y la contraseña. |
| Perú API (.com) | [Alta](https://peruapi.com/registro) | Contraseña, términos, reCAPTCHA y verificación del correo. Autorizar la IP de salida del worker. |
| PerúAPI (.net) | [Alta](https://peruapi.net/client/register) | Para cuenta de empresa, completar RUC, razón social, DNI del responsable y los demás campos exigidos, contraseña y términos. |

La contraseña inicial generada es para el portal; el servicio usa exclusivamente tokens. Configura las llaves de API en [Secrets Manager o en el entorno del worker](../README.md#tokens-de-proveedores). Valida el cupo y su reinicio al crear cada cuenta. Ajusta `billingDay` al día de reinicio mensual si difiere del primer día del mes, y los límites locales hacia abajo cuando sea necesario. El día local se reinicia a medianoche de Lima. Los `Retry-After` válidos del proveedor tienen prioridad para pausas externas.
