import { env } from "../../env";

const rpcUrl = new URL("/rpc", env.NEXT_PUBLIC_API_BASE_URL);

const forwardHeaders = (request: Request) => {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  const accept = request.headers.get("accept");
  if (accept) {
    headers.set("accept", accept);
  }

  const serviceToken = request.headers.get("x-service-token");
  if (serviceToken) {
    headers.set("x-service-token", serviceToken);
  }

  return headers;
};

export async function POST(request: Request) {
  const body = await request.arrayBuffer();
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: forwardHeaders(request),
    body,
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
