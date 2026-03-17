// Minimal App Router pattern with prefetch + hydrate
// app/(routes)/todos/page.tsx (Server Component)
import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query"

import TodosClient from "./TodosClient"

export default async function TodosPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { networkMode: "always" } }, // never pause on server
  })

  await queryClient.prefetchQuery({
    queryFn: () => fetch(`${process.env.API_URL}/todos`).then((r) => r.json()),
    queryKey: ["todos"],
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <TodosClient />
    </HydrationBoundary>
  )
}

// app/(routes)/todos/TodosClient.tsx (Client Component)
;("use client")
import { useQuery } from "@tanstack/react-query"

export default function TodosClient() {
  const { data } = useQuery({
    queryFn: () => fetch("/api/todos").then((r) => r.json()),
    queryKey: ["todos"],
    staleTime: 1000 * 60 * 5,
  })

  return (
    <ul>
      {data?.map((todo: { id: number; title: string }) => (
        <li key={todo.id}>{todo.title}</li>
      ))}
    </ul>
  )
}
