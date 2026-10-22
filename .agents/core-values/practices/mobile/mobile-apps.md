# Mobile apps

> **Load when:** building, changing, or reviewing Android (Kotlin, Compose, Views), iOS (Swift,
> SwiftUI, UIKit), Flutter, or React Native app code: ViewModels and UI state, one-off events,
> client-side coroutines or Swift concurrency, offline sync and background work, list and frame
> performance, Keychain or Keystore, deep links, WebViews, runtime permissions, privacy manifests,
> ATS or network security config, `targetSdk` bumps, safe areas, mobile accessibility, or releases.
> **See also:** [Code design](../core/code-design.md), [Architecture fundamentals](../architecture/architecture-fundamentals.md),
> [Components and state](../frontend/components-and-state.md), [JavaScript and TypeScript](../languages/javascript-typescript.md),
> [Concurrency](../concurrency/concurrency.md), [Application security](../security/application-security.md),
> [API design](../api/api-design.md), [Accessibility](../frontend/accessibility.md), [Testing](../testing/testing.md),
> [Performance and load testing](../testing/performance-and-load-testing.md),
> [Observability](../operations/observability-and-reliability.md), [CI/CD](../devops/ci-cd.md)

## Top rules

1. **Split the app into a UI layer and a data layer, and route every data access through a
   repository.** Views, composables, widgets, and ViewModels never touch a database, file, or
   network client directly, so sources can change and be faked in tests. *[Android Arch Recs;
   Android Arch Guide; Flutter Architecture]*
2. **Never keep app data or state in OS-managed components such as an Activity,
   service, or receiver.** The OS destroys and recreates them on rotation, resize,
   fold, and memory pressure; plan separately for configuration change, process death, and user
   dismissal. *[Android Arch Guide; Android Saving State]*
3. **Model one-off events (snackbar, navigation) as UI state that the UI acknowledges, and collect
   state with lifecycle awareness.** Events sent through a channel or stream get lost when the
   producer outlives the consumer. *[Android UI Events; Android Arch Recs]*
4. **Ship no secrets in the binary or JS bundle; keep tokens only in the Keychain or Android
   Keystore; keep tokens and PII out of logs and crash reporters.** Anything in the package can be
   extracted, and logs are read by other tools and vendors. *[RN Security; Android Security Tips;
   HIG Privacy; Review lessons]*
5. **Treat deep-link, intent, push-payload, and WebView data as untrusted input and parse it at
   the boundary.** Validate every parameter against an allowlist or schema, reject malformed ids
   and NaN, and never put tokens in a link. *[RN Security; Android App Links; Android Security
   Tips; Review lessons]*
6. **Build long lists lazily with stable, unique item keys, never the array index.** Ask what
   happens at 10k rows: virtualize, paginate, and do not recompute derivations per frame.
   *[Compose Performance; RN FlatList; Flutter Performance; Review lessons]*
7. **Make suspend and async functions main-safe and cancellable.** The class doing blocking work
   switches to an injected dispatcher itself, cancellation is never swallowed, and stale responses
   are dropped when the screen or query changes. *[Android Coroutines; Swift 6 Data Race Safety;
   Review lessons]*
8. **Request runtime permissions in context, at the moment the feature needs them, and degrade
   only that feature on denial.** Launch-time prompts and nagging get denied, and Android makes a
   second denial permanent. *[Android Permissions; HIG Privacy]*
9. **Meet platform touch-target, labelling, contrast, and text-scaling minimums, and verify with
   TalkBack and VoiceOver.** Custom tappables are where these regress. *[HIG Accessibility;
   Android Accessibility; Flutter Accessibility; Review lessons]*
10. **Measure performance only in release or profile builds on the lowest-end target device.**
    Debug builds of Flutter and React Native are far slower and mislead; at 60 Hz budget about 8
    ms build plus 8 ms render, less at 120 Hz. *[Flutter Performance; RN Performance]*

## Architecture and state

- **Create one repository per data type over data sources that each wrap one backing store, and
  give each piece of data a single owner that alone mutates it and exposes it as an immutable
  type.** State flows down and events flow up; offline-first apps make the local database the
  owner. *[Android Arch Guide]*
- **Add a domain layer (use cases) only when logic is complex or shared by several ViewModels.**
  Do not scaffold one by default; it adds overhead most apps do not need. *[Android Arch Guide;
  Flutter Architecture]*
- **Scope ViewModels to screens or navigation destinations and keep them free of Activity,
  Context, and Resources references.** Framework references leak memory and block unit tests, so
  avoid `AndroidViewModel` and move `Application` needs into the UI or data layer. *[Android Arch
  Recs]*
- **Keep reusable components and list items stateless, with hoisted state or plain state-holder
  classes.** Pass lambdas such as `onItemClick` into lists instead of the ViewModel, which would
  couple the component to one screen. *[Android Arch Recs; Android UI Events]*
- **Expose one immutable `uiState` per ViewModel backed by a private mutable holder.** A public
  `StateFlow` over a private `MutableStateFlow`, modelled as a Loading / Content / Error sealed
  type, keeps error handling explicit. *[Android Coroutines; Android Offline-First]*
- **In Flutter, keep widgets to show/hide conditions, widget-driven animation, device-based
  layout, and simple routing; everything else goes in a ViewModel or lower.** *[Flutter
  Architecture]*
- **Use immutable models, and in large apps keep network and entity models inside the data layer
  behind explicit mapper functions.** A backend schema change then stops at the mapper instead of
  rippling into the UI. *[Flutter Architecture; Android Offline-First]*
- **Inject dependencies through constructors against abstract repository interfaces, not globally
  reachable singletons.** Each layer becomes swappable for a fake per environment or test; Hilt
  suits large Android apps, manual DI small ones, and Flutter docs point to `provider`. *[Android
  Arch Recs; Flutter Architecture]*
- **On SwiftUI with an iOS 17 / macOS 14 or later deployment target, use `@Observable` with
  `@State`, `@Environment`, and `@Bindable` instead of `ObservableObject`, `@StateObject`, and
  `@EnvironmentObject`.** Views then redraw only when a property the body reads changes; mark
  non-triggering properties `@ObservationIgnored`. Older targets still need `ObservableObject`.
  *[SwiftUI Observation Migration]*

## UI state, events, and lifecycle

- **Put the message or navigation flag in state, and have the UI call back (for example
  `userMessageShown()`) after acting on it so the ViewModel clears it.** This survives recreation;
  when the source screen stays on the back stack, also gate navigation with a saveable UI-held
  flag so it does not fire again on return. *[Android UI Events]*
- **Collect flows with `collectAsStateWithLifecycle`, `repeatOnLifecycle`, or lifecycle effects,
  not overridden Activity callbacks.** Background collection wastes work and can show toasts on
  screens the user cannot see. *[Android Arch Recs; Android UI Events]*
- **Keep saved state (`SavedStateHandle`, `rememberSaveable`) to small values such as an id or a
  query, and put real data in persistent storage.** Saved state survives process death but
  serializes on the main thread, so bitmaps and large structures cause jank. *[Android Saving
  State]*
- **Guard async UI loads against stale responses.** Use `collectLatest` / `flatMapLatest` or a
  request id for search-as-you-type, tie work to the screen's scope, and cancel timers and
  subscriptions when the screen goes away. *[Review lessons; Android Coroutines]*

## Concurrency and async

- **Inject dispatchers and scopes; never hardcode `Dispatchers.IO` or use `GlobalScope`.** Data
  layers expose suspend functions for one-shot calls and Flows for changing data, the ViewModel
  launches in `viewModelScope`, and work that outlives a screen gets an injected application
  scope. *[Android Coroutines; Android Arch Guide]*
- **Never swallow `CancellationException`.** Catch specific exceptions such as `IOException`
  rather than `Exception` or `Throwable`, or rethrow cancellation, and call `ensureActive()`
  inside long CPU or blocking loops. *[Android Coroutines]*
- **In Swift 6 language mode, isolate UI types to `@MainActor` and make every value that crosses
  an isolation boundary `Sendable`.** Public types need explicit conformance because inference
  stops at the module boundary; `@unchecked Sendable` disables the checks, so it needs review.
  *[Swift 6 Data Race Safety]*
- **Do not assume actor state is unchanged across an `await`.** Actors are reentrant at suspension
  points, so keep read-check-write sections synchronous and re-validate after awaiting. *[Swift 6
  Data Race Safety]*
- **On Swift 6.2 or later, set default `MainActor` isolation for app and UI targets, and mark
  async work that must run off the actor, such as image decoding, `@concurrent`.** Under the
  approachable-concurrency settings nonisolated async functions run on the caller's actor, so
  off-main work must be explicit. *[Swift 6.2]*
- **Back "only one at a time" claims with a real mechanism, not a boolean field.** Use unique
  work, a mutex, an actor, or a database constraint; an in-memory flag dies with the process and
  races across threads. *[Review lessons; Android Offline-First]*

## Lists and rendering performance

- **Give lazy-list items stable, unique, saveable keys (an id, never the index or `hashCode()`),
  and set `contentType` for mixed lists.** React Native's `keyExtractor` follows the same rule;
  use `itemsIndexed`, since `indexOf` per item makes layout quadratic. *[Compose Performance; RN
  FlatList]*
- **Avoid layouts that force intrinsic passes over every child, and give grid cells explicit
  sizes.** Intrinsic sizing measures all children twice; for a short bounded list of about ten
  items a plain Row or Column beats virtualization. *[Flutter Performance; Compose Performance]*
- **In Compose, cache expensive calculations with `remember` keyed on every input (or move them to
  the ViewModel), and wrap derivations of fast-changing state such as scroll offsets in
  `derivedStateOf` without keying it on the state read inside.** Keying on the inner state
  recreates the derived state every change; keying cheap work on a large collection costs more
  than the work. *[Compose Performance]*
- **Defer fast-changing state reads to layout or draw with lambda modifiers such as `offset { }`
  and `drawBehind { }`, and never write to state already read in the same composition.** Deferral
  skips recomposition; a backwards write loops it. *[Compose Performance]*
- **In Flutter, keep `build()` cheap and call `setState()` on the smallest subtree that changes.**
  Split large widgets into `StatelessWidget` classes rather than helper functions, pass unchanging
  parts of animated subtrees as a cached `child`, and never override `operator ==` on widgets.
  *[Flutter Performance]*
- **Avoid `saveLayer` triggers, `Opacity` wrappers, and clipping during Flutter animations.** Use
  semitransparent colors, `AnimatedOpacity` or `FadeInImage`, and `borderRadius`; each offscreen
  layer costs a GPU render-target switch. *[Flutter Performance]*
- **In React Native lists, memoize `renderItem` with `useCallback`, wrap rows in `memo`, supply
  `getItemLayout` for fixed-height rows, and load thumbnail-sized images.** Inline arrow
  `renderItem`s defeat memoization; tune `initialNumToRender` to one screenful and consider
  FlashList or Legend List for demanding lists. *[RN FlatList; RN Performance]*
- **Run React Native animations on the native driver, animate `transform: scale` instead of image
  width and height, and defer heavy press handlers with `requestAnimationFrame`.** JS-driven
  animations freeze when the JS thread is busy, and press feedback should render first. *[RN
  Performance]*
- **Strip `console.*` from React Native production bundles with a Babel transform.** Console
  calls, including those in dependencies, bottleneck the JS thread. *[RN Performance]*

## Offline, sync, and networking

- **In offline-first apps, make the local store the only source higher layers read, and pair every
  network-backed repository with a local data source.** Repositories write fetched data locally
  first; readers observe the local Flow. *[Android Offline-First]*
- **Pick a write strategy per data type: online-only, queued, or lazy (local first, then sync).**
  Online-only suits near-real-time writes such as transfers and must tell the user when offline;
  lazy suits critical data and needs versioning plus server-side conflict resolution. *[Android
  Offline-First]*
- **Give every queued write a client-generated id, and enforce it with a unique index in the local
  database and an idempotency key on the server.** A retried sync then cannot apply the same
  change twice. *[Review lessons; Android Offline-First]*
- **Run sync as unique WorkManager work with a network constraint, retry with exponential backoff
  only for retryable errors up to a cap, and drain a persistent queue in order when write order
  matters.** An unauthorized response is not retryable, and `enqueueUniqueWork` prevents
  concurrent syncs but does not order writes. *[Android Offline-First]*
- **Use HTTPS everywhere and keep platform cleartext blocks on.** On iOS never set
  `NSAllowsArbitraryLoads`; scope any unavoidable exception to one domain. On Android allow
  cleartext per domain only, never in `base-config`. *[Apple ATS; Android Network Security
  Config]*
- **Give every HTTP client that carries a token a timeout, and do not follow redirects
  automatically on authenticated calls.** A hung request blocks the UI flow, and a redirect can
  forward credentials to another host. *[Review lessons]*
- **Send and store instants in UTC and route all parsing and formatting through one date helper.**
  Convert to the device zone only for display; the device zone and clock can change while the app
  runs. *[Review lessons]*
- **Never let the app be the tenant boundary.** The server scopes every query by the authenticated
  user or organization; in multi-account apps also key local tables by account and wipe them on
  sign-out. *[Review lessons]* See [Application and API
  security](../security/application-security.md).
- **Choose the Android background API from the platform decision tree, not by habit.** Coroutines
  for work that may stop when the user leaves; WorkManager for deferrable or persistent work,
  split past about ten minutes; a foreground service only when interruption would hurt the user
  and no purpose-built API fits. *[Android Background Work]*

## Security and secrets

- **Proxy secret-bearing calls through a server-side function, and restrict any unavoidable client
  key by package name and signing certificate.** Config libraries such as `react-native-config`
  hold settings, not secrets. *[RN Security; Android Security Tips]*
- **Never store tokens in AsyncStorage, plain SharedPreferences, external storage, or plain files,
  nor persist a whole state tree that may hold form data.** In React Native use
  `expo-secure-store` or `react-native-keychain`. *[RN Security; HIG Privacy; Android Security
  Tips]*
- **Encrypt local data with a Keystore-held key, used directly or through Tink, and exclude
  encrypted files from backup,** since restored ciphertext has no key to decrypt it.
  `EncryptedSharedPreferences` is deprecated (see Tensions). *[AndroidX Security Releases]*
- **Gate verbose logging behind debug build flags.** Apps with `READ_LOGS` can read logcat, and
  crash and analytics vendors keep whatever you send. *[Android Security Tips; RN Security]*
- **Use verified Android App Links and iOS Universal Links for your own domains.** Any app can
  register the same custom URL scheme and intercept it, and intent filters are not a security
  boundary. *[Android App Links; RN Security; Android Security Tips]*
- **Implement OAuth and OIDC with the authorization-code flow plus PKCE through an AppAuth-style
  library.** Without PKCE, an app that intercepts the redirect can redeem the code. *[RN
  Security]*
- **Prefer passkeys and platform sign-in (Credential Manager, Sign in with Apple, Password
  AutoFill), and never store user passwords on the device.** Exchange credentials once for a
  short-lived, scoped token, and add biometrics for apps that stay signed in. *[HIG Privacy;
  Android Security Tips]*
- **If you pin certificates, ship a backup pin and a rotation plan, and put debug CAs under
  `<debug-overrides>`.** A pin without a backup breaks every installed copy when the server key
  changes. *[Android Network Security Config; RN Security]*
- **Declare `android:exported` on every component, protect exported ones with signature-level
  permissions, and use explicit intents for services.** An intent filter silently exports a
  component; ContentProvider queries take parameters, never concatenated `selection` strings.
  *[Android Security Tips]*
- **Leave WebView JavaScript off unless required, expose `addJavascriptInterface` only to content
  packaged with the app, and allow only `http`, `https`, `mailto`, and relative links in rendered
  HTML.** A bridge exposed to remote content hands app capabilities to whoever controls it; escape
  every value interpolated into WebView HTML. *[Android Security Tips; Review lessons]*
- **Use only platform crypto primitives (`Cipher`, `KeyStore`, `SecureRandom`), prefer AES-GCM,
  and never reuse an IV.** With CBC or CTR add HMAC-SHA-256 for integrity; never hand-roll
  algorithms. *[Android Security Tips]*

## Permissions and privacy

- **Check the permission before every protected operation and request the least scope, for
  example coarse location unless the feature needs precise location.** Grants can be revoked or
  auto-reset between uses. *[Android Permissions; HIG Privacy]*
- **On denial, say exactly what is unavailable; never block, nag, or deep-link to Settings to push
  a reversal.** *[Android Permissions; HIG Privacy]*
- **Write iOS purpose strings as one specific, active-voice sentence saying what is collected and
  why; a pre-permission screen offers only a "Continue" button.** App Review rejects incentives,
  screens that imitate the system alert, and features gated on tracking consent. *[HIG Privacy]*
- **Ship a `PrivacyInfo.xcprivacy` manifest in the app and every SDK that collects data, uses
  required-reason APIs, or contacts tracking domains, and add it to the target's resources.** A
  file outside the target is left out of the privacy report. *[Apple Privacy Manifest]*

## Accessibility and adaptive layout

- **Make interactive elements at least 44×44 pt on iOS and 48×48 dp on Android and Flutter.**
  Platform controls comply; set custom tappables explicitly, for example `sizeIn(minWidth = 48.dp,
  minHeight = 48.dp)`. *[HIG Accessibility; Android Accessibility; Flutter Accessibility]*
- **Label every non-text control by its purpose, not its look; omit the control type, make labels
  unique per row, and hide decorative images from assistive tech.** Express the type with a role
  or trait and toggles with a checked state; run the framework's accessibility lint as errors.
  *[Android Accessibility; HIG Accessibility; Review lessons]*
- **Meet 4.5:1 contrast for body text and 3:1 for large text in both light and dark appearance,
  and never convey meaning by color alone.** Prefer system colors, which carry high-contrast
  variants. *[HIG Accessibility; Android Accessibility]*
- **Support text scaling to at least 200% and let layouts reflow instead of truncating.**
  Side-by-side views stack and rows wrap at large sizes; never hardcode text below 11 pt on iOS.
  *[HIG Accessibility; HIG Layout]*
- **Honor Reduce Motion by swapping zoom, scale, and depth transitions for fades, and avoid
  auto-dismissing UI.** *[HIG Accessibility]*
- **Lay out against safe areas and window insets.** Pad tappables with system-bar insets, keep
  swipe areas clear of gesture insets, and avoid cutouts; content under system bars is the usual
  regression after a `targetSdk` bump. *[Android Edge-to-Edge; HIG Layout]*
- **Choose layouts from available window size (size classes, window size classes), not device type
  or orientation, and keep the same features at every size.** Swap presentation instead, for
  example bar, rail, or drawer via `NavigationSuiteScaffold`, and use leading and trailing so
  right-to-left works. *[HIG Layout; Android Arch Guide]*

## Release, tooling, and testing

- **Keep `targetSdk` at the current Google Play floor and retest on every bump.** Since 2026-08-31
  new apps and updates need API 36 (35 for Wear OS and Automotive, 34 for TV and XR); each bump
  changes behavior. *[Play Target API]*
- **When moving to API 36, remove `windowOptOutEdgeToEdgeEnforcement`, migrate back handling off
  `onBackPressed` to the predictive-back APIs, and test on a 600 dp or wider window.** API 36
  disables the edge-to-edge opt-out, stops calling `onBackPressed` on Android 16 devices, and
  ignores orientation and resizability locks on large screens. *[Android 16 Behavior Changes]*
- **Ship Android release builds with full-mode R8, Baseline and Startup Profiles, and
  Macrobenchmark regression tests.** These shrink the app, precompile startup and scroll paths,
  and catch jank before release. *[Android Arch Recs]*
- **Before upgrading React Native, audit native dependencies for TurboModule and Fabric support.**
  The New Architecture can no longer be turned off (see Tensions). *[RN 0.82; RN 0.84]*
- **Prefer hand-written fakes to mocks, and unit-test every ViewModel, repository, and service.**
  Fakes test inputs and outputs, not call sequences, and push toward small interfaces. *[Android
  Arch Recs; Flutter Architecture]* More in [Testing](../testing/testing.md).

## Tensions

- **One-off events as channels vs events as state.** Many tutorials use a `Channel` or
  `SharedFlow`; this library follows Android's guidance to reduce events to acknowledged state,
  and allows a channel only when the consumer outlives the producer. *[Android UI Events]*
- **Certificate pinning: protective vs operationally risky.** React Native presents it as MITM
  protection; Android stresses broken installs. Pinning is optional here, and only with a backup
  pin and rotation plan. *[RN Security; Android Network Security Config; Android Security Tips]*
- **`EncryptedSharedPreferences` vs direct Keystore use.** React Native's page still recommends
  it, but its library deprecated all its APIs in 2025. Use a Keystore key directly or through
  Tink. *[RN Security; AndroidX Security Releases]*
- **React Native New Architecture opt-out.** The landing page still documents
  `newArchEnabled=false`, but since 0.82 the flag is ignored and 0.84 began removing legacy code.
  Do not plan on an opt-out. *[RN New Architecture; RN 0.82; RN 0.84]*
- **Native driver vs Reanimated.** Core docs recommend `useNativeDriver`; Reanimated is a widely
  used community library they do not cover. Default to the native driver; use Reanimated when a
  gesture-driven animation needs UI-thread logic. *[RN Performance]*

## Sources

- **Android Arch Recs**: Recommendations for Android architecture (<https://developer.android.com/topic/architecture/recommendations>)
- **Android Arch Guide**: Guide to app architecture (<https://developer.android.com/topic/architecture>)
- **Android UI Events**: UI events (<https://developer.android.com/topic/architecture/ui-layer/events>)
- **Android Offline-First**: Build an offline-first app (<https://developer.android.com/topic/architecture/data-layer/offline-first>)
- **Android Saving State**: Save UI states (<https://developer.android.com/topic/libraries/architecture/saving-states>)
- **Android Coroutines**: Best practices for coroutines in Android (<https://developer.android.com/kotlin/coroutines/coroutines-best-practices>)
- **Android Background Work**: Background tasks overview (<https://developer.android.com/develop/background-work/background-tasks>)
- **Compose Performance**: Follow best practices, Jetpack Compose performance (<https://developer.android.com/develop/ui/compose/performance/bestpractices>)
- **Android Edge-to-Edge**: Display content edge-to-edge in views (<https://developer.android.com/develop/ui/views/layout/edge-to-edge>)
- **Android Accessibility**: Make apps more accessible (<https://developer.android.com/guide/topics/ui/accessibility/apps>)
- **Android Permissions**: Request runtime permissions (<https://developer.android.com/training/permissions/requesting>)
- **Android Security Tips**: Security tips (<https://developer.android.com/privacy-and-security/security-tips>)
- **Android Network Security Config**: Network security configuration (<https://developer.android.com/privacy-and-security/security-config>)
- **Android App Links**: About App Links (<https://developer.android.com/training/app-links>)
- **Play Target API**: Target API level requirements for Google Play (<https://developer.android.com/google/play/requirements/target-sdk>)
- **Android 16 Behavior Changes**: Behavior changes, apps targeting Android 16 or higher (<https://developer.android.com/about/versions/16/behavior-changes-16>)
- **AndroidX Security Releases**: androidx.security release notes (<https://developer.android.com/jetpack/androidx/releases/security>)
- **HIG Accessibility**: Apple Human Interface Guidelines, Accessibility (<https://developer.apple.com/design/human-interface-guidelines/accessibility>)
- **HIG Privacy**: Apple Human Interface Guidelines, Privacy (<https://developer.apple.com/design/human-interface-guidelines/privacy>)
- **HIG Layout**: Apple Human Interface Guidelines, Layout (<https://developer.apple.com/design/human-interface-guidelines/layout>)
- **Apple ATS**: Preventing insecure network connections (<https://developer.apple.com/documentation/security/preventing-insecure-network-connections>)
- **Apple Privacy Manifest**: Privacy manifest files (<https://developer.apple.com/documentation/bundleresources/privacy-manifest-files>)
- **SwiftUI Observation Migration**: Migrating from the ObservableObject protocol to the Observable macro (<https://developer.apple.com/documentation/swiftui/migrating-from-the-observable-object-protocol-to-the-observable-macro>)
- **Swift 6 Data Race Safety**: Data Race Safety, Swift 6 concurrency migration guide (<https://www.swift.org/migration/documentation/swift-6-concurrency-migration-guide/dataracesafety>)
- **Swift 6.2**: Swift 6.2 Released, Swift.org blog (<https://www.swift.org/blog/swift-6.2-released/>)
- **Flutter Architecture**: Flutter architecture recommendations (<https://docs.flutter.dev/app-architecture/recommendations>)
- **Flutter Performance**: Flutter performance best practices (<https://docs.flutter.dev/perf/best-practices>)
- **Flutter Accessibility**: Flutter accessibility (<https://docs.flutter.dev/ui/accessibility-and-internationalization/accessibility>)
- **RN Performance**: React Native, Performance overview (<https://reactnative.dev/docs/performance>)
- **RN FlatList**: React Native, Optimizing FlatList configuration (<https://reactnative.dev/docs/optimizing-flatlist-configuration>)
- **RN Security**: React Native, Security (<https://reactnative.dev/docs/security>)
- **RN New Architecture**: React Native, About the New Architecture (<https://reactnative.dev/architecture/landing-page>)
- **RN 0.82**: React Native 0.82 release post (<https://reactnative.dev/blog/2025/10/08/react-native-0.82>)
- **RN 0.84**: React Native 0.84 release post (<https://reactnative.dev/blog/2026/02/11/react-native-0.84>)
- **Review lessons**: rules distilled from the maintainer's code-review findings
