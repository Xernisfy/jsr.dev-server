import { parseArgs } from "@std/cli/parse-args";
import { crypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import { exists } from "@std/fs/exists";
import { contentType, type KnownExtensionOrType as Ext } from "@std/media-types/content-type";
import { extname, join, relative } from "@std/path";
import { compileScss } from "@xernisfy/grass-wasm";

type Handler = (req: Request, path: string) => Response | Promise<Response>;
type Routes = [URLPattern, Handler][];

const { _: args, minify, port } = parseArgs(Deno.args, {
  boolean: ["minify"],
  string: ["port"],
  default: { minify: true, port: "0" },
  alias: { port: "p" },
});
const dir = args[0] ? args[0].toString() : ".";
const faviconExtensions = ["ico", "png", "gif", "webp", "svg"];

function contentTypeHeader(extensionOrType: Ext) {
  return { headers: { "Content-Type": contentType(extensionOrType) } };
}
async function hashFile(path: string) {
  return encodeHex(await crypto.subtle.digest("SHA-256", (await Deno.open(path, { read: true })).readable));
}
function serveFile(path: string) {
  return new Response(Deno.openSync(path).readable, contentTypeHeader(extname(path) as Ext));
}

const routes: Routes = [];
function addRoute(pathname: string, handler: Handler) {
  routes.push([new URLPattern({ pathname }), handler]);
}
addRoute("/*\\.ts", async (req: Request, path: string) => {
  const module = await import(`./${relative(dir, path)}?${await hashFile(path)}`);
  const returnValue = await module.default(req);
  return returnValue instanceof Response ? returnValue : new Response(returnValue);
});
addRoute("/*\\.(j|t)sx", async (_req: Request, path: string) => {
  const bundleResult = await Deno.bundle({ entrypoints: [path], minify, platform: "browser" });
  if (!bundleResult.success) throw new Error(`Bundling "${path}" failed!\n${JSON.stringify(bundleResult)}`);
  return new Response(bundleResult.outputFiles?.[0].contents, contentTypeHeader("js"));
});
addRoute("/*\\.s(a|c)ss", async (_req: Request, path: string) => {
  return new Response(compileScss(await Deno.readTextFile(path), minify ? "compress" : "expand"), contentTypeHeader("css"));
});

async function handleRequest(req: Request) {
  const url = new URL(req.url);
  const path = decodeURIComponent(join(dir, url.pathname));
  for (const [pattern, handler] of routes) {
    if (pattern.test(url)) return await handler(req, path);
  }
  if (await exists(path, { isFile: true })) return serveFile(path);
  let testPath;
  if (url.pathname === "/favicon.ico") {
    for (const ext of faviconExtensions) {
      testPath = join(dir, "favicon." + ext);
      if (await exists(testPath, { isFile: true })) return serveFile(testPath);
    }
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 331 331">
  <path id="background" d="M28.829,227.937c-8.871,-19.143 -13.822,-40.465 -13.822,-62.935c-0,-5.815 0.332,-11.554 0.977,-17.197c0.655,-5.703 1.626,-11.299 2.893,-16.773c7.12,-30.704 23.68,-57.808 46.452,-78.082c19.127,-17.006 42.558,-29.14 68.244,-34.64c10.137,-2.165 20.651,-3.304 31.43,-3.304c3.778,0.004 7.583,0.149 11.411,0.441c18.154,1.386 35.309,5.956 50.959,13.121c12.625,5.786 24.31,13.274 34.762,22.169c26.253,22.364 44.562,53.517 50.651,88.476c1.455,8.379 2.213,16.996 2.213,25.789c-0.003,3.784 -0.149,7.595 -0.442,11.429c-1.106,14.489 -4.241,28.342 -9.104,41.302c-6.788,18.051 -16.959,34.452 -29.738,48.428c-16.621,16.971 -37.743,24.523 -55.384,24.209c-12.828,-0.229 -25.379,-5.333 -34.052,-12.801c-12.39,-10.669 -17.394,-22.865 -19.11,-36.474c-0.426,-3.383 -0.176,-12.601 1.585,-18.984c1.312,-4.758 4.64,-13.946 9.507,-17.965c-5.693,-2.452 -13.021,-7.792 -15.331,-10.355c-0.568,-0.63 -0.494,-1.617 0.014,-2.296c0.509,-0.678 1.4,-0.946 2.199,-0.659c4.895,1.68 10.856,3.337 17.142,4.389c8.267,1.382 18.548,3.122 28.963,3.634c25.395,1.247 51.921,-10.151 60.154,-32.83c8.232,-22.679 5.038,-45.111 -24.496,-58.566c-29.535,-13.456 -43.178,-29.455 -67.041,-39.104c-15.587,-6.303 -32.935,-2.561 -50.746,7.282c-47.974,26.512 -90.955,110.279 -71.142,187.887c0.283,1.062 -0.195,2.18 -1.158,2.709c-0.903,0.495 -2.013,0.354 -2.761,-0.331c-5.766,-6.336 -10.998,-13.166 -15.623,-20.421c-3.578,-5.614 -6.79,-11.475 -9.606,-17.548Z" style="fill: #000;"/>
  <path id="eye" d="M159.634,78.772c8.092,-0.634 15.152,6.272 16.369,15.457c1.624,12.235 -2.867,24.874 -17.633,25.165c-12.614,0.252 -16.436,-12.469 -15.6,-20.175c0.83,-7.706 7.182,-19.687 16.864,-20.447Z" style="fill: #000;"/>
</svg>`,
      contentTypeHeader("svg"),
    );
  }
  testPath = `${path}${url.pathname.endsWith("/") ? "index" : ""}.html`;
  if (await exists(testPath, { isFile: true })) return serveFile(testPath);
  return new Response(null, { status: 404 });
}

Deno.serve({ port: parseInt(port) }, async (req) => {
  let res: Response;
  try {
    res = await handleRequest(req);
  } catch (error) {
    console.error(error);
    const { name, message, stack } = error as Error;
    res = new Response(JSON.stringify({ name, message, stack }), { status: 500 });
  }
  console.log(`%c[${res.status}]%c ${req.method} ${req.url}`, `color:${res.ok ? "green" : "red"}`, "");
  return res;
});
