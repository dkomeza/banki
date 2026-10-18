import { MeResponse } from "@banki/shared";
import { queryOptions } from "@tanstack/react-query";
import { api } from "./api";
import { ApiRequestError } from "./query";

export const meQueryOptions = queryOptions({
  queryKey: ["me"],
  queryFn: async () => {
    const res = await api.api.me.$get();
    if (!res.ok) throw new ApiRequestError(res.status);
    return MeResponse.parse(await res.json());
  },
});
