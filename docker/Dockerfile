# mermUId Static-Image (T08). Build-Kontext: Repo-Root.
#   docker build -f docker/Dockerfile -t mermuid:<tag> .
# Stage 1: SvelteKit-Build (adapter-static, Ausgabe build/).
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
# O-11: Header-CSP = exakt content der Meta-CSP aus build/index.html (inkl. Hashes).
# Fehlt die Meta-CSP oder der Platzhalter, bricht der Build ab.
RUN node -e ' \
  const fs = require("fs"); \
  const html = fs.readFileSync("build/index.html", "utf8"); \
  const m = html.match(/<meta http-equiv="content-security-policy" content="([^"]+)"/i); \
  if (!m) { console.error("Meta-CSP fehlt in build/index.html"); process.exit(1); } \
  const csp = m[1]; \
  if (!/sha256-/.test(csp) || /[$\\\n]/.test(csp)) { console.error("Meta-CSP unerwartet: " + csp); process.exit(1); } \
  const conf = fs.readFileSync("docker/nginx.conf", "utf8"); \
  if (conf.split("__META_CSP__").length !== 2) { console.error("Platzhalter __META_CSP__ nicht genau einmal"); process.exit(1); } \
  fs.writeFileSync("/app/nginx.conf", conf.replace("__META_CSP__", () => csp)); \
  console.log("Header-CSP: " + csp); \
'

# Stage 2: reines Static-Hosting, Nicht-Root, Port 8080 (D-14).
FROM nginx:1.30.6-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d
COPY --from=build /app/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/build/ /usr/share/nginx/html/
USER nginx
EXPOSE 8080
# V-30: busybox-wget aus dem Basis-Image, keine Zusatzpakete.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
