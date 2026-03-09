FROM node:18-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN git clone --recurse-submodules --depth 1 https://github.com/MetaversalCorp/MSF_Map_Svc.git . \
	&& npm install \
	&& npm run build:linux:mysql

WORKDIR /build/dist
RUN npm install

COPY web/ /build/dist/web/
COPY generate-blockhead-assets.mjs /usr/local/bin/
RUN node /usr/local/bin/generate-blockhead-assets.mjs /build/dist/web/objects

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_INTERNALPORT=2000
EXPOSE 2000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
