import type { ListKind } from "../api";
import { LIST_KINDS } from "../lists";
import { TrendingShelf } from "../components/Trending";

/** A whole list (a TMDB chart or an MDBList list) as a grid, opened from a shelf's "See all". */
export function ListPage({ arg }: { arg?: string }) {
  const parts = (arg ?? "").split(":");
  let body: React.ReactNode = <p className="notice">That list doesn't exist.</p>;
  if (parts[0] === "mdb" && parts[1]) {
    body = <TrendingShelf type="movie" full custom={{ id: parts[1], name: parts.slice(2).join(":") || "List" }} />;
  } else if (parts[0] === "tmdb" && LIST_KINDS.includes(parts[1] as ListKind) && (parts[2] === "movie" || parts[2] === "series")) {
    body = <TrendingShelf type={parts[2]} list={parts[1] as ListKind} full />;
  }
  return (
    <div className="page">
      <p><a className="link" href="#/home">← Back to Home</a></p>
      {body}
    </div>
  );
}
