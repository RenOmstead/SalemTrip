# Salem Trip 🎃

A phone-friendly map and planner for our trip: **Rockport, Fri Oct 30 to Tue Nov 3, 2026**, with a day trip to **Salem on Sun Nov 1**. It also covers Gloucester (Cape Ann Whale Watch, Hammond Castle).

- **A plan for every day.** Tap a day at the top. Each day has its own town, hours, places, fixed times and parking spot.
- **Where we're staying.** Set the rental once (search, pin or "I'm there now"). Rockport days start and end there.
- **Every place on the map.** About 60 hand-picked highlights (★), plus every shop, restaurant, cafe, bar, museum, gallery, attraction and public parking lot in Salem, Rockport and Gloucester from OpenStreetMap (900+). Zoom in to see them. Search them in **Places**, and turn types on and off in **Settings**.
- **Itineraries that build themselves.** Pick places (★ Must-see for the ones you won't skip), add fixed times like the whale watch, and add breaks like lunch. The planner fits everything around opening hours for that day of the week, sunset and travel time. It walks short hops and drives longer ones on Rockport days, and moves your start earlier when a morning booking needs it.
- **Salem day trip.** It tells you when to leave Rockport to park in Salem on time, then plans the walk from the car.
- **Where we parked.** Save the car with GPS, a garage or a pin, plus a note, the time parking runs out and a photo. **Walk to car** gives directions back.
- **Directions.** **Go** opens Apple Maps or Google Maps (walking or driving to match the leg). **Show route** draws the walking path on the app's own map.
- **On the day.** An "Up next" card, leave-now alerts, Done/Skip, and **Re-plan from here & now**.
- **Calendar and sharing.** **Add trip to calendar** exports every day with leave-by alarms. **Share plan** sends the whole trip to the other phone.
- **Spooky.** A haunted night map (or Daylight), glowing pins and bats. It works offline once the map has loaded.

Everything is saved on your phone (in the browser's local storage). There is no server and no account.

## Put it online (GitHub Pages, free, one time)

The **Publish site** workflow runs the tests and publishes to GitHub Pages on every push. **Settings → Pages → Source** must be set to **GitHub Actions**. The app is live at **https://renomstead.github.io/SalemTrip/**.

To re-download the places from OpenStreetMap, run the **Refresh places from OpenStreetMap** workflow, then **Publish site**.

Open that link on each phone. In Safari, tap **Share → Add to Home Screen**, and allow location when asked.

## Before the trip

1. **Settings → Where we're staying**: set the Rockport rental.
2. For each day at the top, go to **Places** and add what you want to see. Use **★ Must-see** for the ones you won't skip.
3. In **Times**, add anything with a set time on the right day: the whale watch, a Hammond Castle reservation, dinner bookings. Add a lunch break too.
4. Check the hours under **Visit length & hours** for anything important. Built-in hours are typical for this time of year, and shop hours come from OpenStreetMap, so neither is guaranteed. Cape Ann Whale Watch's season usually ends in late October, so confirm your trip.
5. **Settings → Share plan link**, and send it to whoever you're traveling with.
6. **Plan → Add trip to calendar**, so the leave-by reminders go off even when the app is closed.
7. Zoom around Rockport and downtown Salem once so the map is saved for weak-signal moments.

## On the day

1. On the Salem day, follow the "Leave by" time, and tap **🚗 Parked here** when you park. The day's plan then starts and ends at the car.
2. Follow **Up next**. Tap **Directions** to open your maps app, and **✓ Done** when you leave a stop.
3. If you're running late or change your mind, tap **↻ Re-plan from here & now**.
4. To get back to the car, use the **Car** tab, then **Walk to car**.

Good to know: **clocks fall back an hour at 2 AM on Nov 1**, and sunset is about **4:37 PM**. Phones handle the clock change on their own. The planner keeps outdoor spots like Derby Wharf and Chestnut Street before dark.

## Development

No build step. It's plain HTML, CSS and JavaScript modules, with [Leaflet](https://leafletjs.com/) in `vendor/`.

```sh
npm start          # serves the app at http://localhost:8080
npm test           # tests for the planner, opening hours, OSM import, time zones, sunset and calendar export
```

| File | What it does |
| --- | --- |
| `js/places.js` | Hand-picked places in Salem, Rockport and Gloucester: coordinates, typical hours, visit lengths, tips |
| `data/osm-places.json` | Every shop, restaurant, museum and parking lot from OpenStreetMap (made by `scripts/fetch-osm.mjs`) |
| `js/hours.js` | Reads OpenStreetMap opening hours for a given day |
| `js/planner.js` | The itinerary engine. It builds each day around fixed times and opening hours, walking or driving each leg, with a seeded search so every phone gets the same plan |
| `js/time.js` | Salem time zone handling, sunset, and the calendar export |
| `js/app.js` | The map, the panels, parking, directions, sharing and reminders |
| `sw.js` | Offline support for the app and the map tiles you've already seen |

Map data and map tiles © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors. No API keys are needed. Walking routes come from FOSSGIS's OSRM server and place search from Nominatim. All of these are free community services, so the app uses them lightly.
