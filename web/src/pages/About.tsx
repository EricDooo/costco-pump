export function About() {
  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">About</h1>
      <div className="mt-6 max-w-2xl space-y-4 text-sm text-muted">
        <p>
          Costco gas is famously cheap, but Costco doesn't publish a nationwide price
          list anywhere -- you only get one warehouse's price at a time, on its own
          page. This site periodically checks every US Costco with a gas station and
          keeps every price it has ever seen, so you can look at a trend instead of a
          single snapshot.
        </p>
        <p>
          Prices come from Costco's own public warehouse-locator lookup -- the same one
          the "find a warehouse" search on costco.com uses -- checked on a regular
          schedule at a deliberately low request rate. This is not an official Costco
          feed, and it can lag a real-time in-store price by however long it's been
          since the last check.
        </p>
        <p>
          Built and maintained by{' '}
          <a href="https://ericdoo.com" className="text-primary hover:underline">
            Eric Du
          </a>
          . Source is on{' '}
          <a
            href="https://github.com/EricDooo/costco-pump"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </div>
    </div>
  )
}
