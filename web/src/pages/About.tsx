export function About() {
  return (
    <div className="mx-auto max-w-content px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">About</h1>
      <div className="mt-6 max-w-2xl space-y-4 text-sm text-muted">
        <p>
          Costco gas is famously cheap, but Costco doesn't publish a price list
          anywhere. You get one warehouse's price at a time, on its own page, and
          that's it. This site checks every Costco gas station it can find (the US,
          Canada, the UK, and eight more countries at this point) on a regular
          schedule and keeps every price it's ever seen, so you get an actual trend
          instead of a single snapshot.
        </p>
        <p>
          Prices come from Costco's own public warehouse-locator lookup, the same
          one behind the "find a warehouse" search on costco.com, checked on a
          fixed schedule at a low request rate. It's not an official Costco feed,
          so a price shown here can lag what's posted at the pump by however long
          it's been since the last check.
        </p>
        <p>
          Alongside Costco's own numbers, the site pulls in public data from the
          U.S. Energy Information Administration: regional averages, crude oil
          prices, and weekly gasoline supply figures. That's what powers the
          regional comparison on the Analytics page, so you can see how Costco
          stacks up against the rest of the market and get a sense of why prices
          are moving, not just that they are.
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
