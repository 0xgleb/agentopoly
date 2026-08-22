const dashboardDistribution = new URL('./dist/', import.meta.url)

const unavailableProjection = (): Response =>
  Response.json(
    { error: 'local participant has not published a typed dashboard projection' },
    { status: 503 },
  )

const staticAsset = async (pathname: string): Promise<Response | undefined> => {
  const pathSegments = pathname.split('/')
  if (
    pathname.includes('%') ||
    pathSegments[1] !== 'assets' ||
    pathSegments.length < 3 ||
    pathSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('\\'))
  ) {
    return undefined
  }

  const asset = Bun.file(new URL(`.${pathname}`, dashboardDistribution))
  return (await asset.exists()) ? new Response(asset) : undefined
}

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 3000,
  fetch: async (request) => {
    const pathname = new URL(request.url).pathname

    if (pathname === '/api/dashboard/projection') return unavailableProjection()

    const asset = await staticAsset(pathname)
    if (asset !== undefined) return asset

    return new Response(Bun.file(new URL('./index.html', dashboardDistribution)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  },
})

console.log(`Agentopoly dashboard listening at ${server.url}`)
