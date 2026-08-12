export type HostedRoute = {
  meta: { hostedOnly?: boolean }
  params: { documentId?: string | string[] }
}

export async function openHostedRouteDocument(
  route: HostedRoute,
  openDocument: (documentId: string) => Promise<void>
): Promise<boolean> {
  const documentId = route.params.documentId
  if (!route.meta.hostedOnly || typeof documentId !== 'string') return false
  await openDocument(documentId)
  return true
}
