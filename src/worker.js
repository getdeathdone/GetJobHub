const API_PREFIX = "/api/v1/";

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers || {}),
    },
  });
}

function apiOrigin(env) {
  const origin = env.API_ORIGIN;
  if (!origin) return null;

  try {
    const url = new URL(origin);
    const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return { url, basePath };
  } catch {
    return null;
  }
}

async function proxyApi(request, env) {
  const incomingUrl = new URL(request.url);

  if (incomingUrl.pathname === "/api/v1/ping") {
    return json({
      status: "ok",
      message: "GetJobHub Worker API route is alive",
      proxied: Boolean(env.API_ORIGIN),
    });
  }

  const api = apiOrigin(env);
  if (!api) {
    return json(
      {
        detail:
          "API_ORIGIN is not configured for this Worker. Deploy the FastAPI backend separately and set API_ORIGIN to its public origin.",
      },
      { status: 503 },
    );
  }

  const targetUrl = new URL(request.url);
  targetUrl.protocol = api.url.protocol;
  targetUrl.host = api.url.host;
  targetUrl.pathname = `${api.basePath}${incomingUrl.pathname}`;

  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.delete("host");
  proxyHeaders.set("x-forwarded-host", incomingUrl.host);
  proxyHeaders.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));

  const proxyInit = {
    method: request.method,
    headers: proxyHeaders,
    redirect: "manual",
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    proxyInit.body = request.body;
  }

  return fetch(new Request(targetUrl, proxyInit));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith(API_PREFIX) || url.pathname === "/api/v1") {
      return proxyApi(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
