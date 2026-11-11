# Proveedores de DNI y cupos

Fuentes públicas revisadas el 11 de noviembre de 2026. El orden es una propuesta inicial según la cobertura que publica cada proveedor, la procedencia de los datos y el formato de sus respuestas. No se midieron disponibilidad, latencia ni coincidencias con datos reales. Revisa los términos y la procedencia antes de activar cada cuenta. Usa una cuenta por proveedor.

| Prioridad | Proveedor | Consultas gratis recurrentes | Condiciones |
| --- | --- | ---: | --- |
| 1 | [APISPERU](https://apisperu.com/servicios/dniruc) | 1.000/mes | La página anuncia un primer mes ilimitado. Confirma elegibilidad, fecha de vencimiento, límites y que la cuenta vuelva al plan gratis antes de activar la promoción. [Contrato HTTP](https://dniruc.apisperu.com/doc/swagger). |
| 2 | [Factiliza](https://factiliza.com/api-consulta) | 100/mes | Cuota de API Consulta. [Contrato DNI](https://docs.factiliza.com/api-consulta/endpoint/dni). |
| 3 | [Perú API (.com)](https://peruapi.com/precios) | 1.000/mes | 50/día, 10/min, una IP autorizada. El mes sigue el ciclo de la cuenta. [Contrato HTTP](https://peruapi.com/documentacion). |
| | **Total nominal** | **2.100/mes** | Cupo combinado con los tres proveedores habilitados. |

Una consulta consumida no garantiza una persona encontrada. Los proveedores pueden compartir fuentes, responder sin coincidencia o descontar los intentos que fallen. Cada proveedor controla su cupo y lo aplica a todos los sistemas que comparten la cuenta. Usa llaves dedicadas y consulta el saldo en los paneles. [Apis.net.pe migró a Decolecta](https://apis.net.pe/); no se contaron como dos proveedores ni se asumió un cupo de DNI sin publicación verificable.

## Lote inicial de 10.000

El primer mes de APISPERU es la única vía gratuita verificada públicamente entre los adaptadores para ese volumen en un ciclo. Confirma en el panel la disponibilidad y las condiciones de la promoción antes de contar con ella. Si la meta es 10.000 resultados válidos, presupuesta intentos adicionales y mide la cobertura con datos autorizados. Para consultas masivas, el backend debe dosificar las peticiones según los límites del proveedor y respetar los tiempos de reintento del endpoint.

## Alta y configuración

| Proveedor | Registro | Paso pendiente |
| --- | --- | --- |
| APISPERU | [Panel API Consultas](https://apisperu.com/admin/dniruc) | Token configurado en el entorno local. Confirma en el panel si la cuenta tiene la promoción. |
| Factiliza | [Panel API Consulta](https://app.factiliza.com/api-consulta) | Cuenta activada y token configurado en el entorno local. |
| Perú API (.com) | [Panel](https://peruapi.com/panel) | Cuenta activada y token configurado en el entorno local. Su ciclo mensual comienza el día 11. Autorizar la IP de salida de la Lambda al desplegar. |

La contraseña inicial generada es para el portal; el servicio usa exclusivamente tokens. Configura las llaves de API en [Secrets Manager o en el entorno de la Lambda](../README.md#tokens-de-proveedores). Valida el cupo y su reinicio al crear cada cuenta. Ajusta `billingDay` al día de reinicio mensual si difiere del primer día del mes. Si el proveedor indica cuándo reintentar en `Retry-After`, la Lambda usa ese valor. Para un aviso de cuota agotada sin esa cabecera, estima el reinicio diario o mensual a medianoche de Lima.
