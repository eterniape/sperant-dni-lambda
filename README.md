# Sperant DNI Lambda

Servicio interno que devuelve nombres y apellidos a partir de un DNI peruano. API Gateway envía el POST a una Lambda, que consulta los proveedores de forma secuencial. Si un proveedor falla, agota su cuota o no encuentra el DNI, la Lambda prueba el siguiente. Devuelve la primera coincidencia válida en la misma respuesta HTTP.

El orden de consulta por defecto es **APISPERU → Factiliza → Perú API (.com)**. Con los tres proveedores habilitados, el cupo gratuito recurrente suma hasta **2.100 consultas al mes**, con un máximo de 50 al día en Perú API. Cada proveedor aplica los límites de su propia cuenta. [Cupos y proveedores disponibles](docs/proveedores.md).

El módulo `service/src/dni` separa la validación de identidad (`domain`), la resolución secuencial (`application`), las integraciones (`infrastructure`) y el contrato HTTP (`transport`). [Plantilla de AWS SAM](template.yaml).

## Levantar en local

Desde la raíz del repositorio, con Node.js 24:

```sh
npm --prefix service ci --ignore-scripts
test -f .env || (umask 077 && cp .env.example .env)
```

Si `DNI_CLIENT_TOKEN` está vacío, genera un token y copia el valor en esa variable del `.env`:

```sh
node -p 'require("node:crypto").randomBytes(32).toString("base64url")'
```

Para iniciar el servidor:

```sh
npm --prefix service run dev
```

El servidor escucha en `127.0.0.1:3000` y usa datos ficticios. `00000001` devuelve una identidad de ejemplo y `00000002` devuelve `DNI_NOT_FOUND`.

## Usar el endpoint

Envía `POST /v1/dni/consulta` con el DNI como cadena de ocho dígitos para conservar posibles ceros iniciales. En otra terminal, desde la raíz:

```sh
DNI_BASE_URL='http://127.0.0.1:3000/v1/dni/consulta'
DNI_CLIENT_TOKEN="$(node --env-file=.env -p 'process.env.DNI_CLIENT_TOKEN')"

curl -i -X POST "$DNI_BASE_URL" \
  -H "Authorization: Bearer $DNI_CLIENT_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dni":"00000001"}'
```

Una coincidencia devuelve **200 OK** con el siguiente cuerpo. `apellidoMaterno` puede ser `null`.

```json
{
  "status": "found",
  "data": {
    "nombres": "Ana María",
    "apellidoPaterno": "De la Cruz",
    "apellidoMaterno": null
  },
  "provider": "demo"
}
```

| HTTP | Respuesta |
| --- | --- |
| 400 | `INVALID_DNI` si el cuerpo no es un objeto JSON con un único campo `dni` de ocho dígitos. |
| 401 | `UNAUTHORIZED` si falta el token Bearer o es inválido. |
| 403 | Acceso denegado en modo IAM. |
| 404 | `DNI_NOT_FOUND` cuando todos los proveedores configurados reportan que no encontraron el DNI. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` si falta `Content-Type: application/json`. |
| 429 | API Gateway aplicó su límite de peticiones. |
| 503 | `PROVIDERS_UNAVAILABLE` cuando ningún proveedor pudo resolver la consulta y al menos uno no respondió de forma concluyente, o cuando no hay proveedores configurados. `SERVICE_UNAVAILABLE` indica un error interno. |

Un `503` puede incluir `Retry-After` en segundos y, para `PROVIDERS_UNAVAILABLE`, `retryAt` en UTC. Si el backend reintenta, envía otro POST después de ese plazo. Cada POST puede consumir cupo. El tiempo límite es de 14 segundos para Factiliza, 2,3 segundos para cada uno de los otros proveedores y 27 segundos para la Lambda. Todas las respuestas de la Lambda llevan `Cache-Control: no-store`.

## Token y variables de entorno

Configura `DNI_BASE_URL` en el backend con la salida `LookupUrl` del stack. Guarda `DNI_CLIENT_TOKEN` del lado del servidor y envíalo en `Authorization: Bearer <token>`. En AWS, la Lambda lee el mismo token de Secrets Manager mediante `ClientAuthSecretArn`. Usa un token independiente por entorno.

| Variable o parámetro | Uso |
| --- | --- |
| `DNI_BASE_URL` | URL completa del POST para el backend. |
| `DNI_CLIENT_TOKEN` | Token Bearer del backend y del servidor local de pruebas. |
| `DNI_LOCAL_PORT` | Puerto local opcional. Valor por defecto 3000. |
| `DNI_TOKEN_APISPERU`, `DNI_TOKEN_FACTILIZA`, `DNI_TOKEN_PERUAPI_COM` | Llaves de proveedores. Un token vacío deja fuera al proveedor. |
| `DNI_PERUAPI_COM_BILLING_DAY` | Día de inicio del ciclo de Perú API para estimar el próximo reinicio si se agota el cupo. La cuenta configurada usa el día 11. |
| `ClientAuthSecretArn`, `ProvidersSecretArn` | ARN de los secretos del token Bearer y de los proveedores, respectivamente. |

Para usar IAM, omite `ClientAuthSecretArn` y firma el POST con SigV4, servicio `execute-api` y región del stack. Concede al rol del backend `execute-api:Invoke` sobre `arn:aws:execute-api:REGION:ACCOUNT:API_ID/$default/POST/v1/dni/consulta`.

## Configuración y despliegue

Requiere Node.js 24 y AWS SAM CLI compatible con `nodejs24.x`. La Lambda utiliza el cliente de Secrets Manager incluido en el runtime. [Runtime de Node.js en AWS Lambda](https://docs.aws.amazon.com/lambda/latest/dg/lambda-nodejs.html).

La [guía de despliegue](docs/despliegue.md) describe cómo preparar los secretos, autorizar la IP fija que exige Perú API y revisar el stack antes de ejecutarlo.

### Tokens de proveedores

- **Secrets Manager en AWS.** Ejecuta `node scripts/prepare-deploy.mjs --stage prod` para preparar la configuración del `.env`. Carga `providers.json` como secreto y pasa su ARN en `ProvidersSecretArn`. El orden de los proveedores en el secreto es el orden de consulta. [Formato del secreto](docs/providers.example.json).
- **Variables de la Lambda.** Si dejas `ProvidersSecretArn` vacío, configura los tokens de [.env.example](.env.example) en `HttpFunction` mediante tu mecanismo de despliegue. El servicio consulta APISPERU, Factiliza y Perú API (.com) en ese orden cuando están habilitados.

La Lambda procesa el DNI y los nombres durante la solicitud y no los guarda. Los logs de AWS tienen 14 días de retención y registran el resultado técnico de cada proveedor sin DNI, nombres ni tokens.

## Pruebas locales

```sh
npm --prefix service run check
npm --prefix service test
```
