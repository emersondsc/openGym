FROM node:22-alpine AS runtime
# A árvore dentro da imagem espelha a do repositório: /app/api (o servidor) e
# /app/frontend/src/lib (o catálogo único). Assim `../frontend/src/lib/exercises-data.json`,
# que é como api/catalog.js resolve o caminho, vale igual no Pi e aqui dentro.
# O contexto de build é a RAIZ do repositório (ver docker-compose.yml) — os COPY abaixo
# começam todos com `api/`.
WORKDIR /app/api
COPY api/package.json api/package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
# Glob, não lista de nomes: foi um COPY arquivo a arquivo que quase derrubou a BACKLOG-01 com o
# `units.js` faltando na imagem, e nem teste nem build local pegam isso. Os *.test.js viajam
# junto por causa do glob e são removidos na linha seguinte — nada em produção os usa.
COPY api/*.js ./
RUN rm -f ./*.test.js
COPY frontend/src/lib/exercises-data.json /app/frontend/src/lib/exercises-data.json
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]

# Alvo de teste: `RUN`, não `CMD` — `docker build --target test -f api/Dockerfile .` precisa
# FALHAR quando a suíte falha, senão o portão do deploy não prova nada (um `CMD` fazia o build
# passar sem rodar um único teste). Os testes voltam por COPY porque o estágio `runtime` os
# apaga; os caminhos são relativos ao WORKDIR (/app/api). Nada disto entra na imagem de produção.
#
# Com este estágio no FIM do arquivo ele passa a ser o alvo padrão do build do Compose — daí o
# `target: runtime` no docker-compose.yml.
FROM runtime AS test
COPY api/*.test.js ./
# Os fixtures JSON também: o glob `api/*.js` do estágio de produção não os leva, e sem eles a
# suíte de contrato do routines.test.js morre no primeiro readFileSync.
COPY api/*.json ./
RUN node --test ./*.test.js
