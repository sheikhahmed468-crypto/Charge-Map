import { useEffect, useMemo, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet'
import L from 'leaflet'
import {
  BatteryCharging,
  Building2,
  Calculator,
  CarFront,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Gauge,
  LocateFixed,
  Map,
  Menu,
  Navigation,
  Phone,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Zap,
} from 'lucide-react'
import 'leaflet/dist/leaflet.css'
import './App.css'

const fallbackStations = [
  { name: 'Emporium Mall', city: 'Lahore', position: [31.4697, 74.2686], type: 'DC', power: '150 kW', price: 'PKR 120/kWh', status: 'Status unverified' },
  { name: 'Packages Mall', city: 'Lahore', position: [31.4717, 74.3565], type: 'DC', power: '60 kW', price: 'PKR 95/kWh', status: 'Status unverified' },
  { name: 'Centaurus Mall', city: 'Islamabad', position: [33.7077, 73.0502], type: 'DC', power: '120 kW', price: 'PKR 110/kWh', status: 'Status unverified' },
  { name: 'Dolmen Mall', city: 'Karachi', position: [24.8073, 67.0298], type: 'AC', power: '22 kW', price: 'PKR 55/kWh', status: 'Status unverified' },
]

const pakistanCities = {
  lahore: [31.5204, 74.3587],
  islamabad: [33.6844, 73.0479],
  rawalpindi: [33.5651, 73.0169],
  karachi: [24.8607, 67.0011],
  faisalabad: [31.4504, 73.135],
  multan: [30.1575, 71.5249],
  peshawar: [34.0151, 71.5249],
  murree: [33.9073, 73.3943],
  hyderabad: [25.396, 68.3578],
  gujranwala: [32.1877, 74.1945],
  sialkot: [32.4945, 74.5229],
  bahawalpur: [29.3956, 71.6836],
  sargodha: [32.0836, 72.6711],
  sukkur: [27.7052, 68.8574],
  quetta: [30.1798, 66.975],
  abbottabad: [34.1688, 73.2215],
}

const features = [
  { icon: Map, title: 'Pakistan charger map', text: 'Browse listed AC and DC stations across Pakistan and filter by charger type.', target: 'map' },
  { icon: Navigation, title: 'Journey planner', text: 'Plan charging stops along your route and arrive with less range anxiety.', target: 'journey' },
  { icon: Calculator, title: 'Charging calculator', text: 'Estimate charging time, energy used and cost for your exact vehicle and battery.', target: 'calculator' },
  { icon: ShieldCheck, title: 'Station details', text: 'Review listed connector, power, price, amenity and contact details where provided.', target: 'map' },
  { icon: CarFront, title: 'EV charge planning', text: 'Estimate energy, charging time and cost using your battery and charger details.', target: 'calculator' },
  { icon: Gauge, title: 'Range converter', text: 'Convert EPA, WLTP, NEDC and CLTC range estimates into comparable figures.', target: 'ev-tools' },
  { icon: Building2, title: 'Station owner tools', text: 'Preview owner tools; the dashboard figures shown are sample data, not live analytics.', target: 'owners' },
  { icon: Phone, title: 'Community reports', text: 'Preview a station report; submissions are not sent to a review system in this demo.', target: 'submit' },
]

const stationIcon = L.divIcon({
  className: 'station-marker',
  html: '<span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2 4.8 13H11l-1 9 8.2-11H12l1-9Z"/></svg></span>',
  iconSize: [38, 38],
  iconAnchor: [19, 38],
})

function distanceMeters(first, second) {
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(second[0] - first[0])
  const longitudeDelta = radians(second[1] - first[1])
  const a = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first[0])) * Math.cos(radians(second[0])) *
    Math.sin(longitudeDelta / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function stationKey(station) {
  return `${station.name}-${station.position.join('-')}`
}

function stationDirectionsUrl(station) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(station.position.join(','))}&travelmode=driving`
}

function findRouteChargers(routeCoordinates, availableStations) {
  return availableStations
    .map((station) => {
      let closestDistance = Infinity
      let routeProgress = 0
      routeCoordinates.forEach((point, index) => {
        const distance = distanceMeters(station.position, [point[1], point[0]])
        if (distance < closestDistance) {
          closestDistance = distance
          routeProgress = index / Math.max(1, routeCoordinates.length - 1)
        }
      })
      return { ...station, routeDistance: closestDistance, routeProgress }
    })
    .filter((station) => station.routeDistance <= 30000)
    .sort((first, second) => first.routeProgress - second.routeProgress)
}

function App() {
  const [city, setCity] = useState('')
  const [stations, setStations] = useState(fallbackStations)
  const [selectedStation, setSelectedStation] = useState(stations[0])
  const [chargerFilter, setChargerFilter] = useState('All')
  const [battery, setBattery] = useState(25)
  const [batteryCapacity, setBatteryCapacity] = useState(75)
  const [targetCharge, setTargetCharge] = useState(80)
  const [energyPrice, setEnergyPrice] = useState(120)
  const [power, setPower] = useState(150)
  const [journey, setJourney] = useState({ from: 'Lahore', to: 'Islamabad' })
  const [currentLocation, setCurrentLocation] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [vehicleRange, setVehicleRange] = useState(300)
  const [routeMode, setRouteMode] = useState('Smart')
  const [routePlan, setRoutePlan] = useState(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [rangeValue, setRangeValue] = useState(420)
  const [rangeStandard, setRangeStandard] = useState('WLTP')
  const [submissionSent, setSubmissionSent] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [classifier, setClassifier] = useState({
    location: '',
    latitude: null,
    longitude: null,
    traffic: 'unknown',
    population: 'unknown',
    evAdoption: 'unknown',
    parking: 'unknown',
    gridAccess: 'unknown',
  })
  const [assessment, setAssessment] = useState(null)
  const [assessmentLoading, setAssessmentLoading] = useState(false)
  const [assessmentError, setAssessmentError] = useState('')
  const [siteLocationLoading, setSiteLocationLoading] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const loadStations = async () => {
      try {
        const response = await fetch('/chargers.json', { signal: controller.signal })
        if (!response.ok) return
        const data = await response.json()
        const source = Array.isArray(data) ? data : data.chargers
        const listedStations = (source || [])
          .map((charger, index) => {
            const latitude = charger.lat ?? charger.latitude
            const longitude = charger.lng ?? charger.lon ?? charger.longitude
            if (!latitude || !longitude) return null
            return {
              name: charger.name || charger.operator || `EV Charging Station ${index + 1}`,
              city: charger.city || 'Pakistan',
              position: [latitude, longitude],
              type: charger.type === 'DC' ? 'DC' : 'AC',
              power: charger.powerKW ? `${charger.powerKW} kW` : 'Connector details',
              price: Number(charger.price) > 0 ? `PKR ${charger.price}/kWh` : 'Price on arrival',
              status: charger.status || 'Status unverified',
              address: charger.address || '',
              connectors: Array.isArray(charger.connectors) ? charger.connectors : [],
              operator: charger.operator || '',
              phone: charger.phone || '',
              amenities: Array.isArray(charger.amenities) ? charger.amenities : [],
            }
          })
          .filter(Boolean)
        if (listedStations.length) {
          setStations(listedStations)
          setSelectedStation(listedStations[0])
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.warn('Bundled charger data unavailable; using fallback stations.', error)
        }
      }
    }
    loadStations()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          revealObserver.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -32px 0px' })

    document.documentElement.classList.add('has-scroll-reveal')
    document.querySelectorAll('.reveal-on-scroll').forEach((element) => revealObserver.observe(element))

    return () => {
      revealObserver.disconnect()
      document.documentElement.classList.remove('has-scroll-reveal')
    }
  }, [])

  const energyRequired = useMemo(
    () => batteryCapacity * Math.max(0, targetCharge - battery) / 100,
    [battery, batteryCapacity, targetCharge],
  )
  const chargeEstimate = useMemo(() => {
    if (energyRequired === 0) return 0
    return Math.ceil((energyRequired / (power * 0.88)) * 60)
  }, [energyRequired, power])

  const runClassifier = async (event) => {
    event.preventDefault()
    setAssessmentLoading(true)
    setAssessmentError('')
    setAssessment(null)
    try {
      const response = await fetch('/api/site-assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: classifier.location,
          latitude: classifier.latitude,
          longitude: classifier.longitude,
          traffic: classifier.traffic,
          population: classifier.population,
          ev_adoption: classifier.evAdoption,
          parking: classifier.parking,
          grid_access: classifier.gridAccess,
        }),
      })
      let data
      try {
        data = await response.json()
      } catch {
        throw new Error('The assessment API returned an invalid response. Check that the FastAPI server is running.')
      }
      if (!response.ok) {
        const detail = typeof data.detail === 'string'
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail.map((item) => item.msg).join(', ')
            : 'Could not assess this site. Please try again.'
        throw new Error(detail)
      }
      setAssessment(data)
    } catch (error) {
      setAssessmentError(error.message || 'Could not connect to the site assessment API.')
    } finally {
      setAssessmentLoading(false)
    }
  }

  const useSiteLocation = () => {
    if (!navigator.geolocation) {
      setAssessmentError('Location access is not available in this browser.')
      return
    }
    setSiteLocationLoading(true)
    setAssessmentError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setClassifier((current) => ({
          ...current,
          location: current.location || 'Current location',
          latitude: coords.latitude,
          longitude: coords.longitude,
        }))
        setSiteLocationLoading(false)
      },
      (error) => {
        setSiteLocationLoading(false)
        setAssessmentError(error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access or enter a location name.'
          : 'Could not get your location. Please try again.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const planJourney = async (event, journeyInput = journey, originCoordinates = currentLocation) => {
    event?.preventDefault()
    const from = journeyInput.from.trim().toLowerCase()
    const to = journeyInput.to.trim().toLowerCase()
    const start = originCoordinates || pakistanCities[from]
    const destination = pakistanCities[to]

    if (!start || !destination) {
      setRouteError(originCoordinates
        ? 'Choose a supported Pakistan destination from the suggestions.'
        : 'Use your location or choose a supported Pakistan city from the suggestions.')
      setRoutePlan(null)
      return
    }
    if (!originCoordinates && from === to) {
      setRouteError('Choose different start and destination cities.')
      setRoutePlan(null)
      return
    }

    setRouteLoading(true)
    setRouteError('')
    setRoutePlan(null)
    try {
      const coordinates = `${start[1]},${start[0]};${destination[1]},${destination[0]}`
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`)
      if (!response.ok) throw new Error('The route service could not calculate this trip.')
      const data = await response.json()
      const route = data.routes?.[0]
      if (!route) throw new Error('No driving route was found for these cities.')
      const routeCoordinates = route.geometry.coordinates
      const nearbyStations = findRouteChargers(routeCoordinates.filter((_, index) => index % 8 === 0 || index === routeCoordinates.length - 1), stations)
      const distanceKm = Math.round(route.distance / 1000)
      const requiredStops = Math.max(0, Math.ceil(distanceKm / vehicleRange) - 1)
      let stops = []
      if (requiredStops > 0 && nearbyStations.length > 0) {
        const chosen = []
        for (let stop = 1; stop <= requiredStops; stop += 1) {
          const targetProgress = stop / (requiredStops + 1)
          const next = nearbyStations
            .filter((station) => !chosen.includes(station))
            .sort((first, second) => {
              const progressDifference =
                Math.abs(first.routeProgress - targetProgress) -
                Math.abs(second.routeProgress - targetProgress)
              if (Math.abs(progressDifference) > 0.08) return progressDifference
              if (routeMode === 'Cheapest') {
                const firstPrice = Number.parseInt(first.price.replace(/\D/g, ''), 10) || Number.MAX_SAFE_INTEGER
                const secondPrice = Number.parseInt(second.price.replace(/\D/g, ''), 10) || Number.MAX_SAFE_INTEGER
                return firstPrice - secondPrice
              }
              if (routeMode === 'Fastest') {
                return Number.parseInt(second.power, 10) - Number.parseInt(first.power, 10)
              }
              return progressDifference
            })[0]
          if (next) chosen.push(next)
        }
        stops = chosen.sort((first, second) => first.routeProgress - second.routeProgress)
      }
      setRoutePlan({
        coordinates: routeCoordinates.map(([longitude, latitude]) => [latitude, longitude]),
        distanceKm,
        driveMinutes: Math.round(route.duration / 60),
        stops,
        requiredStops,
        from: originCoordinates ? 'Current location' : journeyInput.from.trim(),
        fromCoordinates: originCoordinates,
        to: journeyInput.to.trim(),
      })
    } catch (error) {
      setRouteError(error.message || 'Unable to plan this trip right now. Please try again.')
    } finally {
      setRouteLoading(false)
    }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setRouteError('Location access is not available in this browser.')
      return
    }
    setLocationLoading(true)
    setRouteError('')
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const coordinates = [coords.latitude, coords.longitude]
        const updatedJourney = { ...journey, from: 'Current location' }
        setCurrentLocation(coordinates)
        setJourney(updatedJourney)
        setLocationLoading(false)
        planJourney(undefined, updatedJourney, coordinates)
      },
      (error) => {
        setLocationLoading(false)
        setRouteError(error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access or enter a start city.'
          : 'Could not get your location. Please try again or enter a start city.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    )
  }

  const searchTerm = city.trim().toLowerCase()
  const filteredStations = stations.filter((station) => {
    const searchableDetails = [
      station.name,
      station.city,
      station.address,
      station.operator,
      ...(station.connectors || []),
    ].join(' ').toLowerCase()
    return (chargerFilter === 'All' || station.type === chargerFilter) &&
      (!searchTerm || searchableDetails.includes(searchTerm))
  })
  const activeStation = filteredStations.find((station) => stationKey(station) === stationKey(selectedStation))
    || filteredStations[0]
    || selectedStation
  const listedCities = new Set(
    stations.map((station) => station.city?.trim()).filter((stationCity) => stationCity && stationCity.toLowerCase() !== 'pakistan'),
  ).size

  return (
    <main>
      <header className="navbar">
        <a className="brand" href="#top" aria-label="Charge Map home">
          <span className="brand-mark"><Zap size={20} fill="currentColor" /></span>
          <span>Charge <span>Map</span></span>
        </a>
        <nav id="primary-navigation" className={menuOpen ? 'nav-links open' : 'nav-links'}>
          <a href="#map" onClick={() => setMenuOpen(false)}>Find chargers</a>
          <a href="#journey" onClick={() => setMenuOpen(false)}>Journey planner</a>
          <a href="#calculator" onClick={() => setMenuOpen(false)}>Calculator</a>
          <a href="#ev-tools" onClick={() => setMenuOpen(false)}>EV tools</a>
          <a href="#suitability" onClick={() => setMenuOpen(false)}>Site checker</a>
        </nav>
        <a className="nav-action" href="#map"><LocateFixed size={17} /> Explore map</a>
        <button
          className="menu-button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          aria-controls="primary-navigation"
        >
          <Menu size={22} />
        </button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span /> Pakistan's EV charging network</div>
          <h1>Find every charge.<br /><em>Go everywhere.</em></h1>
          <p>Locate EV stations, plan the perfect route and charge with confidence anywhere in Pakistan.</p>
          <form
            className="search-box"
            onSubmit={(event) => {
              event.preventDefault()
              document.getElementById('map')?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            <Search size={20} />
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              placeholder="Search city or charger"
              aria-label="Search city or charger"
            />
            <button type="submit">
              Search <ChevronRight size={17} />
            </button>
          </form>
          <div className="hero-stats">
            <div><strong>{stations.length}</strong><span>Listed stations</span></div>
            <div><strong>{listedCities}</strong><span>Cities listed</span></div>
            <div><strong>Road</strong><span>Trip planning</span></div>
          </div>
        </div>
        <div className="hero-visual">
          <div className="phone-card">
            <div className="phone-top">
              <div className="phone-logo"><Zap size={13} fill="currentColor" /></div>
              <span>Charge Map · Preview</span>
              <div className="phone-avatar">A</div>
            </div>
            <div className="mini-map">
              <div className="road road-a" /><div className="road road-b" /><div className="road road-c" />
              <span className="map-pin pin-a"><Zap size={12} fill="currentColor" /></span>
              <span className="map-pin pin-b"><Zap size={12} fill="currentColor" /></span>
              <span className="map-pin pin-c"><Zap size={12} fill="currentColor" /></span>
              <div className="map-location"><Navigation size={16} fill="currentColor" /></div>
            </div>
            <div className="station-sheet">
              <div className="sheet-handle" />
              <div className="station-head">
                <div className="station-icon"><BatteryCharging size={21} /></div>
                <div><strong>Station preview</strong><span><span className="live-dot unverified" /> Status unverified</span></div>
              </div>
              <div className="station-tags"><span>DC fast</span><span>150 kW</span><span>PKR 120/kWh</span></div>
              <a href="#map"><Navigation size={15} fill="currentColor" /> Explore stations</a>
            </div>
          </div>
          <div className="floating-card rating-card">
            <div className="rating-icon"><Star size={18} fill="currentColor" /></div>
            <div><strong>4.8</strong><span>Sample rating</span></div>
          </div>
          <div className="floating-card count-card"><strong>{stations.length}</strong><span>stations listed</span></div>
        </div>
      </section>

      <section className="map-section reveal-on-scroll" id="map">
        <div className="section-heading">
          <div><span className="section-kicker">Pakistan network</span><h2>Find your next charge</h2></div>
          <div className="map-actions">
            {['All', 'AC', 'DC'].map((filter) => (
              <button key={filter} className={chargerFilter === filter ? 'active' : ''} onClick={() => setChargerFilter(filter)}>
                {filter === 'All' ? 'All chargers' : filter}
              </button>
            ))}
          </div>
        </div>
        <p className="map-directory-meta">
          Showing <strong>{filteredStations.length}</strong> of {stations.length} listed locations · Availability is not verified in real time
        </p>
        <div className="map-layout">
          <div className="station-list" data-testid="station-list">
            {filteredStations.length === 0 && (
              <p className="station-empty">No stations match that search. Try another city or charger name.</p>
            )}
            {filteredStations.map((station) => (
              <button
                key={stationKey(station)}
                className={stationKey(activeStation) === stationKey(station) ? 'station-item selected' : 'station-item'}
                onClick={() => setSelectedStation(station)}
              >
                <div className="station-list-icon"><Zap size={18} fill="currentColor" /></div>
                <div>
                  <strong>{station.name}</strong>
                  <span>{station.city} · {station.power}</span>
                  <small className={`station-status ${station.status === 'Available' ? 'available' : station.status === 'Busy' ? 'busy' : 'unverified'}`}>
                    <i /> {station.status}
                  </small>
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
          </div>
          <div className="live-map">
            <MapContainer center={[31.5204, 74.3587]} zoom={6} scrollWheelZoom>
              <TileLayer
                attribution='&copy; OpenStreetMap'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {filteredStations.map((station) => (
                <Marker
                  key={stationKey(station)}
                  position={station.position}
                  icon={stationIcon}
                  eventHandlers={{ click: () => setSelectedStation(station) }}
                >
                  <Popup>
                    <strong>{station.name}</strong><br />
                    {station.power} · {station.price}
                    {station.connectors?.length > 0 && <><br />{station.connectors.join(', ')}</>}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
            {filteredStations.length > 0 && <div className="map-detail">
              <span className={activeStation.status === 'Available' ? 'status-live' : activeStation.status === 'Busy' ? 'status-busy' : 'status-unverified'}>{activeStation.status}</span>
              <strong>{activeStation.name}</strong>
              <small>{activeStation.city} · {activeStation.type} · {activeStation.power}</small>
              <small>{activeStation.price}</small>
              {activeStation.address && <small>{activeStation.address}</small>}
              {activeStation.connectors?.length > 0 && <small>Connectors: {activeStation.connectors.join(', ')}</small>}
              {activeStation.amenities?.length > 0 && <small>Amenities: {activeStation.amenities.join(', ')}</small>}
              {activeStation.phone && <a className="station-phone" href={`tel:${activeStation.phone.replace(/[^\d+]/g, '')}`}>Call {activeStation.phone}</a>}
              <a href={stationDirectionsUrl(activeStation)} target="_blank" rel="noreferrer"><Navigation size={16} fill="currentColor" /> Directions</a>
            </div>}
          </div>
        </div>
      </section>

      <section className="features-section reveal-on-scroll" id="planner">
        <div className="section-heading centered">
          <span className="section-kicker">Built for electric journeys</span>
          <h2>Everything you need before you plug in</h2>
        </div>
        <div className="feature-grid">
          {features.map(({ icon: Icon, title, text, target }) => (
            <article key={title}>
              <div className="feature-icon"><Icon size={25} /></div>
              <h3>{title}</h3>
              <p>{text}</p>
              <a href={`#${target}`}>Explore <ChevronRight size={15} /></a>
            </article>
          ))}
        </div>
      </section>

      <section className="journey-section reveal-on-scroll" id="journey">
        <div className="journey-copy">
          <span className="section-kicker">Journey planner</span>
          <h2>Plan every stop <em>before you leave.</em></h2>
          <p>Choose your route and EV range. Get road distance, drive time and charging stops along the way.</p>
          <form onSubmit={planJourney}>
            <div className="journey-form">
              <label>Starting point<input list="pakistan-cities" value={journey.from} onChange={(event) => { setCurrentLocation(null); setJourney({ ...journey, from: event.target.value }) }} /></label>
              <button type="button" aria-label="Swap route points" onClick={() => { setCurrentLocation(null); setJourney({ from: journey.to, to: journey.from }) }}><Route size={18} /></button>
              <label>Destination<input
                list="pakistan-cities"
                value={journey.to}
                onChange={(event) => setJourney({ ...journey, to: event.target.value })}
                onBlur={() => {
                  if (currentLocation && journey.to.trim() && routePlan?.to !== journey.to.trim()) planJourney()
                }}
              /></label>
              <datalist id="pakistan-cities">{Object.keys(pakistanCities).map((name) => <option key={name} value={name.replace(/\b\w/g, (letter) => letter.toUpperCase())} />)}</datalist>
            </div>
            <button className="location-button" type="button" onClick={useMyLocation} disabled={locationLoading}>
              <LocateFixed size={15} /> {locationLoading ? 'Finding your location…' : 'Use my current location'}
            </button>
            <div className="journey-options">
              <label>EV range
                <select value={vehicleRange} onChange={(event) => setVehicleRange(Number(event.target.value))}>
                  <option value="250">250 km</option><option value="300">300 km</option><option value="400">400 km</option><option value="500">500 km</option>
                </select>
              </label>
              <label>Plan for
                <select value={routeMode} onChange={(event) => setRouteMode(event.target.value)}>
                  <option>Smart</option><option>Fastest</option><option>Cheapest</option>
                </select>
              </label>
            </div>
            <button className="journey-button" type="submit" disabled={routeLoading}>
              {routeLoading ? 'Planning route…' : 'Plan my journey'} <ChevronRight size={17} />
            </button>
          </form>
          {routeError && <p className="route-error" role="alert">{routeError}</p>}
          {routePlan && (
            <div className="route-results" data-testid="route-results" aria-live="polite">
              <div><span>Route distance</span><strong>{routePlan.distanceKm} km</strong></div>
              <div><span>Drive time</span><strong>{Math.floor(routePlan.driveMinutes / 60)}h {routePlan.driveMinutes % 60}m</strong></div>
              <div><span>Charging stops</span><strong>{routePlan.stops.length}{routePlan.requiredStops > routePlan.stops.length ? '+' : ''}</strong></div>
            </div>
          )}
        </div>
        <div className="journey-map">
          {routePlan ? (
            <>
              <MapContainer bounds={routePlan.coordinates} scrollWheelZoom>
                <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Polyline positions={routePlan.coordinates} pathOptions={{ color: '#20b86a', weight: 5 }} />
                {routePlan.stops.map((station) => (
                  <Marker key={stationKey(station)} position={station.position} icon={stationIcon}>
                    <Popup><strong>{station.name}</strong><br />{station.power} · {station.price}</Popup>
                  </Marker>
                ))}
              </MapContainer>
              <div className="route-summary"><strong>{routePlan.from} → {routePlan.to}</strong><span>{routePlan.stops.length} suggested charging stops · {routeMode} plan</span></div>
            </>
          ) : (
            <>
              <div className="route-road route-road-a" /><div className="route-road route-road-b" />
              <div className="route-stop stop-a"><Zap size={13} fill="currentColor" /></div>
              <div className="route-stop stop-b"><Zap size={13} fill="currentColor" /></div>
              <div className="route-point point-a">{journey.from.slice(0, 3)}</div>
              <div className="route-point point-b">{journey.to.slice(0, 3)}</div>
              <div className="route-summary"><strong>Ready when you are</strong><span>Enter your trip and plan EV charging stops</span></div>
            </>
          )}
        </div>
        {routePlan && (
          <div className="journey-stop-list">
            <h3>Charging stops along your route</h3>
            {routePlan.stops.length ? routePlan.stops.map((station) => (
              <article key={stationKey(station)}>
                <span className="journey-stop-icon"><Zap size={16} fill="currentColor" /></span>
                <div><strong>{station.name}</strong><small>{station.city} · {station.type} · {station.power}</small></div>
                <span>{station.price}</span>
              </article>
            )) : (
              <p>{routePlan.requiredStops === 0
                ? `Your selected ${vehicleRange} km EV range should cover this trip without a charging stop.`
                : 'No mapped chargers were found near this route. Review your range or plan an alternate stop.'}</p>
            )}
            <a
              className="external-directions"
              href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(routePlan.fromCoordinates ? routePlan.fromCoordinates.join(',') : routePlan.from)}&destination=${encodeURIComponent(routePlan.to)}&travelmode=driving`}
              target="_blank"
              rel="noreferrer"
            >
              Open driving directions <Navigation size={15} />
            </a>
          </div>
        )}
      </section>

      <section className="ev-tools-section reveal-on-scroll" id="ev-tools">
        <div className="ev-tools-heading">
          <div><span className="section-kicker">EV tools</span><h2>Choose with better information.</h2></div>
          <p>Use your own vehicle details to compare range and charging scenarios.</p>
        </div>
        <div className="ev-tools-grid">
          <article className="ev-card catalog-card">
            <div className="ev-card-icon"><CarFront size={24} /></div>
            <span className="ev-label">Charge session planner</span>
            <h3>Estimate for your battery</h3>
            <p>Enter your battery size, current charge, target and local energy rate to get a tailored estimate.</p>
            <div className="vehicle-row"><strong>Personalized estimate</strong><span>Battery · charger · price</span></div>
            <a className="catalog-link" href="#calculator">Open charging calculator <ChevronRight size={16} /></a>
          </article>
          <article className="ev-card converter-card">
            <div className="ev-card-icon"><Gauge size={24} /></div>
            <span className="ev-label">Range converter</span>
            <h3>Compare quoted ranges</h3>
            <div className="range-input">
              <input aria-label="Quoted range" type="number" min="100" max="1000" value={rangeValue} onChange={(event) => setRangeValue(Number(event.target.value))} />
              <select value={rangeStandard} onChange={(event) => setRangeStandard(event.target.value)}>
                <option>WLTP</option><option>EPA</option><option>NEDC</option><option>CLTC</option>
              </select>
            </div>
            <div className="range-result">
              <span>Estimated EPA range</span>
              <strong>{rangeStandard === 'EPA' ? rangeValue : Math.round(rangeValue * (rangeStandard === 'WLTP' ? 0.86 : rangeStandard === 'NEDC' ? 0.82 : 0.78))} km</strong>
            </div>
          </article>
        </div>
      </section>

      <section className="calculator-section reveal-on-scroll" id="calculator">
        <div className="calculator-copy">
          <span className="section-kicker">Charging calculator</span>
          <h2>Know your charge time <em>before you arrive.</em></h2>
          <p>Set your battery size, current and target charge, charger power and energy price for a tailored estimate.</p>
          <div className="calculator-controls">
            <label>Battery size (kWh)
              <input aria-label="Battery size" type="number" min="10" max="250" value={batteryCapacity} onChange={(event) => setBatteryCapacity(Number(event.target.value) || 0)} />
            </label>
            <label>Current battery <strong>{battery}%</strong>
              <input aria-label="Current battery level" type="range" min="0" max="99" value={battery} onChange={(event) => setBattery(Number(event.target.value))} />
            </label>
            <label>Target charge <strong>{targetCharge}%</strong>
              <input aria-label="Target charge level" type="range" min="1" max="100" value={targetCharge} onChange={(event) => setTargetCharge(Number(event.target.value))} />
            </label>
            <label>Charger power
              <select value={power} onChange={(event) => setPower(Number(event.target.value))}>
                <option value="7">7 kW · Home AC</option>
                <option value="22">22 kW · Public AC</option>
                <option value="60">60 kW · DC fast</option>
                <option value="150">150 kW · Ultra fast</option>
              </select>
            </label>
            <label>Energy price (PKR/kWh)
              <input aria-label="Energy price" type="number" min="0" step="1" value={energyPrice} onChange={(event) => setEnergyPrice(Number(event.target.value) || 0)} />
            </label>
          </div>
        </div>
        <div className="calculator-result" aria-live="polite">
          <div className="result-ring">
            <div><Clock3 size={22} /><strong>{chargeEstimate} min</strong><span>to {targetCharge}% charge</span></div>
          </div>
          <div className="result-row"><span>Energy required</span><strong>{energyRequired.toFixed(1)} kWh</strong></div>
          <div className="result-row"><span>Estimated cost</span><strong>PKR {Math.round(energyRequired * energyPrice).toLocaleString()}</strong></div>
          <small className="calculator-disclaimer">Assumes 88% efficiency and constant charger power; actual sessions vary.</small>
        </div>
      </section>

      <section className="owner-section reveal-on-scroll" id="owners">
        <div className="owner-heading">
          <div><span className="section-kicker">For station owners</span><h2>Turn every charger into a destination.</h2></div>
          <p>Preview the visibility, availability and booking insights a connected owner dashboard could provide.</p>
        </div>
        <div className="owner-layout">
          <div className="owner-metrics">
            <article><span><Map size={18} /></span><div><strong>1,240</strong><small>Sample profile views</small></div></article>
            <article><span><Navigation size={18} /></span><div><strong>96</strong><small>Sample navigation taps</small></div></article>
            <article><span><CircleDollarSign size={18} /></span><div><strong>PKR 84.6k</strong><small>Sample monthly earnings</small></div></article>
          </div>
          <div className="owner-dashboard">
            <div className="dashboard-top"><strong>Station performance preview</strong><span>Sample data</span></div>
            <div className="dashboard-chart">
              {[42, 58, 49, 74, 68, 88, 82, 96].map((height, index) => (
                <i key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
            <div className="dashboard-bottom"><span>Views <strong>1,240</strong></span><span>Bookings <strong>18</strong></span><span>Growth <strong>+23%</strong></span></div>
          </div>
        </div>
      </section>

      <section className="submit-section reveal-on-scroll" id="submit">
        <div className="submit-copy">
          <span className="section-kicker">Community network</span>
          <h2>Know a charger we are missing?</h2>
          <p>Try the station report form. This demo does not send submissions to a server yet.</p>
          <div className="submit-benefits"><span><ShieldCheck size={16} /> Takes under a minute</span><span><ShieldCheck size={16} /> Demo only</span></div>
        </div>
        <form className="submit-card" onSubmit={(event) => { event.preventDefault(); setSubmissionSent(true) }}>
          <label>Station name<input required placeholder="e.g. Mall or petrol station" /></label>
          <div className="submit-grid">
            <label>City<input required placeholder="City" /></label>
            <label>Connector<select><option>CCS2</option><option>CHAdeMO</option><option>Type 2</option><option>GB/T</option></select></label>
          </div>
          <button type="submit">{submissionSent ? 'Report preview complete' : 'Preview report'} {submissionSent ? <ShieldCheck size={17} /> : <ChevronRight size={17} />}</button>
        </form>
      </section>

      <section className="suitability-section reveal-on-scroll" id="suitability">
        <div className="suitability-copy">
          <span className="section-kicker">AI site checker</span>
          <h2>Is this location ready for an EV station?</h2>
          <p>Get an AI suitability score with a clear explanation of each factor. The score is decision support, not a calibrated probability.</p>
          <div className="ai-badge"><Sparkles size={17} /> Local open-source AI</div>
        </div>
        <form className="classifier-card" onSubmit={runClassifier}>
          <label>Location name<input required minLength={2} value={classifier.location} onChange={(event) => setClassifier({ ...classifier, location: event.target.value, latitude: null, longitude: null })} placeholder="Street, area or city" /></label>
          <button className="site-location-button" type="button" onClick={useSiteLocation} disabled={siteLocationLoading}>
            <LocateFixed size={15} /> {siteLocationLoading ? 'Getting location…' : 'Use current location to check nearby chargers'}
          </button>
          {classifier.latitude !== null && classifier.longitude !== null && (
            <p className="site-coordinates">Location captured; nearby station count will be measured from the bundled station dataset.</p>
          )}
          <div className="classifier-grid">
            <label>Traffic
              <select value={classifier.traffic} onChange={(event) => setClassifier({ ...classifier, traffic: event.target.value })}>
                <option value="unknown">Unknown</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
              </select>
            </label>
            <label>Population density
              <select value={classifier.population} onChange={(event) => setClassifier({ ...classifier, population: event.target.value })}>
                <option value="unknown">Unknown</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
              </select>
            </label>
            <label>EV adoption
              <select value={classifier.evAdoption} onChange={(event) => setClassifier({ ...classifier, evAdoption: event.target.value })}>
                <option value="unknown">Unknown</option><option value="low">Low</option><option value="moderate">Moderate</option><option value="high">High</option>
              </select>
            </label>
            <label>Parking availability
              <select value={classifier.parking} onChange={(event) => setClassifier({ ...classifier, parking: event.target.value })}>
                <option value="unknown">Unknown</option><option value="yes">Available</option><option value="no">Not available</option>
              </select>
            </label>
            <label>Grid access
              <select value={classifier.gridAccess} onChange={(event) => setClassifier({ ...classifier, gridAccess: event.target.value })}>
                <option value="unknown">Unknown</option><option value="limited">Limited</option><option value="adequate">Adequate</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={assessmentLoading}>
            {assessmentLoading ? 'Assessing site…' : 'Assess site suitability'} <Sparkles size={17} />
          </button>
          {assessmentError && <p className="assessment-error" role="alert">{assessmentError}</p>}
          {assessment && (
            <div className="site-assessment-result" aria-live="polite">
              <div className="assessment-score">
                <strong>{assessment.score}%</strong>
                <span>AI-estimated suitability score</span>
              </div>
              <p className="assessment-summary">{assessment.summary}</p>
              <h3>Factor-by-factor assessment</h3>
              <div className="assessment-factors" data-testid="assessment-factors">
                {assessment.factors.map((factor) => (
                  <article key={factor.factor}>
                    <div className="factor-heading">
                      <strong>{factor.factor}</strong>
                      <span className={`factor-impact ${factor.impact}`}>{factor.impact}</span>
                    </div>
                    <p>{factor.explanation}</p>
                    <small>{factor.value} · Source: {factor.source}</small>
                  </article>
                ))}
              </div>
              <p className="assessment-limitations">{assessment.limitations}</p>
            </div>
          )}
        </form>
      </section>

      <footer>
        <a className="brand" href="#top"><span className="brand-mark"><Zap size={20} fill="currentColor" /></span><span>Charge <span>Map</span></span></a>
        <p>Listed EV charging locations across Pakistan.</p>
        <div><a href="#map">Find chargers</a><a href="#calculator">Calculator</a><a href="#suitability">Site checker</a></div>
      </footer>
    </main>
  )
}

export default App
