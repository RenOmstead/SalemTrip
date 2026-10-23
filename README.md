# Salem Trip 🎃

A phone-friendly map and day planner for a day in Salem, MA (Sunday, Nov 1, 2026).

- **Map with your location.** A live blue dot on a street map of Salem, with pins for about 45 places: witch-trial sites, museums, the waterfront, food, shops, garages and the train station.
- **Where we parked.** Tap **🚗 Parked here** to save the car's spot from GPS. Or pick a garage, or tap the map. You can add a note ("Level 2, by the stairs"), the time parking runs out, and a photo. **Walk to car** gives directions back.
- **Where we're going.** Pick places from the list or the map. Mark the ones you can't miss as **★ Must-see**. Add your own places by searching, or by pressing and holding on the map.
- **Times we have to be places.** Add fixed times for tours, dinner bookings or the train home, plus flexible breaks like "lunch for 45 min sometime 11:30–1:30".
- **An itinerary that builds itself.** The planner fits your places around the fixed times. It respects opening hours and sunset, keeps the walking short, fits as many stops as it can, and tells you what didn't fit and why. It shows when to leave for each fixed time.
- **Directions.** **Go**/**Directions** opens turn-by-turn walking directions in Apple Maps or Google Maps. **Show route** draws the walking route on the app's own map, with a list of turns.
- **On the day.** An **Up next** card, a countdown to your next fixed time, "leave now" alerts, and ✓ Done/Skip buttons. **Re-plan from here & now** rebuilds the rest of the day from where you're standing.
- **Calendar export.** Saves the day as a calendar file, with alarms at leave-by times and before parking runs out.
- **Share with your travel partner.** **Share plan** makes a link with the whole plan in it. Opening it on another phone loads the same plan.
- **Works with a weak signal.** You can add it to your home screen. The app and any map areas you've already looked at keep working offline.

Everything is saved on your phone (in the browser's local storage). There is no server and no account.

## Put it online (GitHub Pages, free, one time)

1. On GitHub, open **Settings → Pages** for this repository.
2. Under **Build and deployment**, choose **Source: Deploy from a branch**.
3. Pick the branch with this code and the **/ (root)** folder, then click **Save**.
4. After about a minute the app is live at **https://renomstead.github.io/SalemTrip/**.

Open that link on each phone. In Safari, tap **Share → Add to Home Screen**, and allow location when asked.

## Before the trip

1. Open the app on Wi-Fi, go to **Places**, and add what you want to see. Use **★ Must-see** for the ones you won't skip.
2. In **Times**, add anything with a set time (tours, reservations) and a lunch break.
3. Check the hours under **Visit length & hours** for anything important. The built-in hours are typical November hours, not guarantees.
4. **Settings → Share plan link**, and send it to whoever you're traveling with.
5. **Plan → Add to calendar**, so the leave-by reminders go off even when the app is closed.
6. Zoom around downtown once so the map is saved for weak-signal moments.

## On the day

1. When you park, tap **🚗 Parked here**. The day's plan then starts and ends at the car.
2. Follow **Up next**. Tap **Directions** to open your maps app, and **✓ Done** when you leave a stop.
3. If you're running late or change your mind, tap **↻ Re-plan from here & now**.
4. To get back to the car, use the **Car** tab, then **Walk to car**.

Good to know: **clocks fall back an hour at 2 AM on Nov 1**, and sunset is about **4:37 PM**. Phones handle the clock change on their own. The planner keeps outdoor spots like Derby Wharf and Chestnut Street before dark.

## Development

No build step. It's plain HTML, CSS and JavaScript modules, with [Leaflet](https://leafletjs.com/) in `vendor/`.

```sh
npm start          # serves the app at http://localhost:8080
npm test           # tests for the itinerary planner, time zones, sunset and calendar export
```

| File | What it does |
| --- | --- |
| `js/places.js` | The curated Salem places: coordinates, typical hours, visit lengths, tips |
| `js/planner.js` | The itinerary engine. It builds the day around fixed times and opening hours, with a seeded search so every phone gets the same plan |
| `js/time.js` | Salem time zone handling, sunset, and the calendar export |
| `js/app.js` | The map, the panels, parking, directions, sharing and reminders |
| `sw.js` | Offline support for the app and the map tiles you've already seen |

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, with tiles by CARTO. Walking routes come from FOSSGIS's OSRM server and place search from Nominatim. All of these are free community services, so the app uses them lightly.
