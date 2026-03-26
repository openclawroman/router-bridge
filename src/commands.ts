export async function handleRouterOn(_ctx: unknown): Promise<{ text: string }> {
  return { text: "🔧 Router backend enabled for this scope." };
}

export async function handleRouterOff(_ctx: unknown): Promise<{ text: string }> {
  return { text: "🔧 Router backend disabled — using native." };
}

export async function handleRouterStatus(_ctx: unknown): Promise<{ text: string }> {
  return { text: "📊 Router status: [stub]" };
}
