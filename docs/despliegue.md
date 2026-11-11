# Despliegue a producción

El stack crea una Lambda, una ruta POST en API Gateway y los grupos de logs. El orden predeterminado es APISPERU y Factiliza.

## Preparar la sesión y los secretos

Ejecuta desde la raíz del repositorio con Node.js 24, AWS CLI 2 y AWS SAM CLI. Sustituye el perfil y la región del ejemplo por los valores de producción. Comprueba la cuenta con `aws sts get-caller-identity`.

```sh
export AWS_PROFILE=perfil-produccion
export AWS_REGION=us-east-1
aws sso login --profile "$AWS_PROFILE"
aws sts get-caller-identity

node scripts/prepare-deploy.mjs --stage prod
```

El script valida los proveedores con token y prepara `providers.json` y `client-auth.json` en `.local/deploy/prod/`, con permisos privados y excluidos de Git. Reutiliza el token de producción en ejecuciones posteriores. Este token es independiente de `DNI_CLIENT_TOKEN` en el `.env` local.

Para un entorno nuevo, crea ambos secretos y guarda los ARN que devuelven.

```sh
aws secretsmanager create-secret --name sperant/dni/prod/providers \
  --secret-string file://.local/deploy/prod/providers.json --query ARN --output text
aws secretsmanager create-secret --name sperant/dni/prod/client-auth \
  --secret-string file://.local/deploy/prod/client-auth.json --query ARN --output text
```

Para actualizar los proveedores después del primer despliegue, regenera `providers.json` y ejecuta `aws secretsmanager put-secret-value --secret-id sperant/dni/prod/providers --secret-string file://.local/deploy/prod/providers.json`. La Lambda refresca el secreto en hasta un minuto.

## Revisar y publicar el stack

Asigna los ARN de los secretos a las variables del comando. Usa la misma cuenta y región para el stack y los secretos. Para usar la salida a internet que proporciona Lambda por defecto, deja vacíos `LambdaSubnetIds` y `LambdaSecurityGroupIds`.

```sh
sam validate --lint
sam build
sam deploy --stack-name sperant-dni-prod --resolve-s3 \
  --capabilities CAPABILITY_IAM --no-execute-changeset \
  --parameter-overrides \
  "ProvidersSecretArn=$DNI_PROVIDERS_ARN" "ClientAuthSecretArn=$DNI_CLIENT_AUTH_ARN"
```

Ejecuta el conjunto de cambios en CloudFormation después de revisarlo. Prueba el POST en la URL `LookupUrl`. Comprueba que devuelve `401` sin token y `200` con los nombres y apellidos de un DNI conocido y autorizado cuando envías el token de producción. [Contrato del endpoint](../README.md#usar-el-endpoint).

Después de la prueba, configura `DNI_BASE_URL` en el backend con `LookupUrl` y `DNI_CLIENT_TOKEN` con el campo `token` de `client-auth.json`.

Para rotar el token, genera otro valor de 32 bytes en base64url, actualiza `token` en el secreto `client-auth` y actualiza el backend. La Lambda refresca el secreto en hasta un minuto. Para autenticar con IAM, omite `ClientAuthSecretArn` y firma las peticiones con SigV4.
