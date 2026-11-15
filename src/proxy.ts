import { NextResponse, type NextRequest } from "next/server";

/**
 * Redirection optimiste : sans cookie de session, les espaces privés renvoient
 * vers la connexion. La vérification réelle (session valide, rôle,
 * permissions) est effectuée côté serveur dans chaque page, action et route.
 */
const PROTECTED = ["/client", "/preparateur", "/admin", "/paiement-demo"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = request.cookies.has("packio_session");
  if (!hasSession && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.search = `?suivant=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico|robots.txt|sitemap.xml|api/webhooks).*)"],
};
