import type { ServiceError } from "../api";

export function ErrorList({ errors }: { errors: ServiceError[] }) {
  if (errors.length === 0) return null;
  return (
    <ul className="notice error">
      {errors.map((e, i) => (
        <li key={`${e.serviceId}-${i}`}>
          <strong>{e.name}</strong>: {e.message}
        </li>
      ))}
    </ul>
  );
}
