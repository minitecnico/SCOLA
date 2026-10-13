# gpt4free como motor de IA do SCOLA (opcional)

O SCOLA já aceita qualquer API compatível com OpenAI (Painel do administrador → Motor de IA).
O [gpt4free](https://github.com/xtekky/gpt4free) expõe uma API assim, então roda ao lado, em Docker, sem mexer no código.

> Atenção: o gpt4free usa acessos não oficiais a serviços de terceiros. Pode falhar ou mudar a qualquer momento
> e pode ferir termos de uso desses serviços. Use como motor reserva (o SCOLA tenta o próximo da fila se um falha),
> não como único motor de um produto vendido.

## Subir

```bash
cd docker/gpt4free
cp .env.example .env        # edite G4F_API_KEY
docker compose up -d        # API local em http://127.0.0.1:1337/v1
curl -H "Authorization: Bearer SUA_CHAVE" http://127.0.0.1:1337/v1/models
# a pasta har_and_cookies é criada por você (não pelo Docker), senão o contêiner não consegue gravar nela
```

## Publicar em https (o SCOLA roda na nuvem, `localhost` não serve)

1. Cloudflare Zero Trust → Networks → Tunnels → criar túnel, copiar o token para `CLOUDFLARE_TUNNEL_TOKEN` no `.env`.
2. No túnel, adicionar um Public Hostname (ex.: `g4f.seudominio.com`) apontando para `http://g4f:8080`.
3. `docker compose --profile tunel up -d`

## Ligar no SCOLA

Painel do administrador → Motor de IA → novo motor:
- Endereço: `https://g4f.seudominio.com/api/Yqcloud/v1` (fixa o provedor Yqcloud)
- Chave: o valor de `G4F_API_KEY`
- Modelo: `gpt-4o-mini`

Por que fixar o provedor: em 13/10/2026 a escolha automática (`/v1/chat/completions`) quebrava na imagem
`latest-slim` (`OperaAria has no attribute 'working'`). Testados por `/api/<Provedor>/v1`: Yqcloud funciona;
PollinationsAI e Blackbox falharam. Provedores gratuitos mudam toda hora, então teste de novo se parar.

O SCOLA testa a conexão antes de salvar.
