type Handler = (req: Request, path: string) => Response | Promise<Response>;
type Routes = [URLPattern, Handler][];
