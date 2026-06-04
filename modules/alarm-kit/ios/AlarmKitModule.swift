import ExpoModulesCore
import Foundation

#if canImport(AlarmKit)
import AlarmKit
import AppIntents
import SwiftUI
import UIKit
#endif

private let openTaskEventName = "onOpenTask"
private let pendingOpenTaskActionsKey = "vouch_alarmkit_pending_open_task_actions_v1"

private struct AlarmKitOpenTaskAction: Codable {
  let taskId: String
  let reminderId: String
  let nativeAlarmId: String

  var eventBody: [String: String] {
    [
      "taskId": taskId,
      "reminderId": reminderId,
      "nativeAlarmId": nativeAlarmId
    ]
  }
}

private final class AlarmKitOpenTaskActionStore {
  static let shared = AlarmKitOpenTaskActionStore()
  static let didEnqueueNotification = Notification.Name("VouchAlarmKitDidEnqueueOpenTaskAction")

  private let lock = NSLock()
  private let defaults = UserDefaults.standard

  func enqueue(_ action: AlarmKitOpenTaskAction) {
    lock.lock()
    var actions = readActionsLocked()
    actions.append(action)
    writeActionsLocked(actions)
    lock.unlock()

    NotificationCenter.default.post(name: Self.didEnqueueNotification, object: nil)
  }

  func consumeAll() -> [AlarmKitOpenTaskAction] {
    lock.lock()
    let actions = readActionsLocked()
    defaults.removeObject(forKey: pendingOpenTaskActionsKey)
    lock.unlock()
    return actions
  }

  private func readActionsLocked() -> [AlarmKitOpenTaskAction] {
    guard let data = defaults.data(forKey: pendingOpenTaskActionsKey) else {
      return []
    }
    return (try? JSONDecoder().decode([AlarmKitOpenTaskAction].self, from: data)) ?? []
  }

  private func writeActionsLocked(_ actions: [AlarmKitOpenTaskAction]) {
    guard let data = try? JSONEncoder().encode(actions) else {
      defaults.removeObject(forKey: pendingOpenTaskActionsKey)
      return
    }
    defaults.set(data, forKey: pendingOpenTaskActionsKey)
  }
}

struct ScheduleTenMinuteAlarmInput: Record {
  @Field var reminderId: String
  @Field var taskId: String
  @Field var taskTitle: String
  @Field var fireAtISO: String
}

struct CancelTenMinuteAlarmInput: Record {
  @Field var nativeAlarmId: String
}

public class AlarmKitModule: Module {
  private var openTaskObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("AlarmKit")
    Events(openTaskEventName)

    AsyncFunction("isAlarmKitAvailableAsync") { () -> Bool in
      return AlarmKitManager.shared.isAlarmKitAvailable
    }

    AsyncFunction("getAlarmAuthorizationStatusAsync") { () -> String in
      return AlarmKitManager.shared.authorizationStatus
    }

    AsyncFunction("requestAlarmAuthorizationAsync") { () async -> String in
      return await AlarmKitManager.shared.requestAuthorization()
    }

    AsyncFunction("scheduleTenMinuteAlarmAsync") { (input: ScheduleTenMinuteAlarmInput) async throws -> [String: String] in
      let nativeAlarmId = try await AlarmKitManager.shared.scheduleTenMinuteAlarm(input)
      return ["nativeAlarmId": nativeAlarmId]
    }

    AsyncFunction("cancelTenMinuteAlarmAsync") { (input: CancelTenMinuteAlarmInput) throws in
      try AlarmKitManager.shared.cancelTenMinuteAlarm(nativeAlarmId: input.nativeAlarmId)
    }

    AsyncFunction("consumePendingOpenTaskActionsAsync") { () -> [[String: String]] in
      return AlarmKitOpenTaskActionStore.shared.consumeAll().map { $0.eventBody }
    }

    OnStartObserving(openTaskEventName) {
      self.startOpenTaskObserving()
    }

    OnStopObserving(openTaskEventName) {
      self.stopOpenTaskObserving()
    }
  }

  private func startOpenTaskObserving() {
    stopOpenTaskObserving()
    openTaskObserver = NotificationCenter.default.addObserver(
      forName: AlarmKitOpenTaskActionStore.didEnqueueNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.emitPendingOpenTaskActions()
    }
    emitPendingOpenTaskActions()
  }

  private func stopOpenTaskObserving() {
    if let openTaskObserver {
      NotificationCenter.default.removeObserver(openTaskObserver)
      self.openTaskObserver = nil
    }
  }

  private func emitPendingOpenTaskActions() {
    for action in AlarmKitOpenTaskActionStore.shared.consumeAll() {
      sendEvent(openTaskEventName, action.eventBody)
    }
  }
}

private final class AlarmKitManager {
  static let shared = AlarmKitManager()

  var isAlarmKitAvailable: Bool {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      return true
    }
    #endif
    return false
  }

  var authorizationStatus: String {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      return mapAuthorizationState(AlarmManager.shared.authorizationState)
    }
    #endif
    return "unavailable"
  }

  func requestAuthorization() async -> String {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      do {
        let state = try await AlarmManager.shared.requestAuthorization()
        return mapAuthorizationState(state)
      } catch {
        return "denied"
      }
    }
    #endif
    return "unavailable"
  }

  func scheduleTenMinuteAlarm(_ input: ScheduleTenMinuteAlarmInput) async throws -> String {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      return try await scheduleTenMinuteAlarmOnIOS26(input)
    }
    #endif
    throw NSError(
      domain: "VouchAlarmKit",
      code: 1,
      userInfo: [NSLocalizedDescriptionKey: "AlarmKit is unavailable on this platform."]
    )
  }

  func cancelTenMinuteAlarm(nativeAlarmId: String) throws {
    #if canImport(AlarmKit)
    if #available(iOS 26.0, *) {
      guard let uuid = UUID(uuidString: nativeAlarmId) else {
        return
      }
      try AlarmManager.shared.cancel(id: uuid)
      return
    }
    #endif
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private func mapAuthorizationState(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .authorized:
      return "authorized"
    case .denied:
      return "denied"
    case .notDetermined:
      return "not_determined"
    @unknown default:
      return "unavailable"
    }
  }

  @available(iOS 26.0, *)
  private func scheduleTenMinuteAlarmOnIOS26(_ input: ScheduleTenMinuteAlarmInput) async throws -> String {
    guard AlarmManager.shared.authorizationState == .authorized else {
      throw NSError(
        domain: "VouchAlarmKit",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "AlarmKit authorization is not granted."]
      )
    }

    guard let fireDate = ISO8601DateFormatter.vouchAlarmKitDate(from: input.fireAtISO), fireDate > Date() else {
      throw NSError(
        domain: "VouchAlarmKit",
        code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Alarm fire date is invalid or in the past."]
      )
    }

    let id = UUID()
    let alarmTitle = "10 min reminder | \(input.taskTitle)"
    let presentation = AlarmPresentation(
      alert: AlarmPresentation.Alert(
        title: LocalizedStringResource(String.LocalizationValue(alarmTitle)),
        stopButton: AlarmButton(text: "Dismiss", textColor: .orange, systemImageName: "xmark.circle"),
        secondaryButton: AlarmButton(text: "Open App", textColor: .white, systemImageName: "arrow.up.forward"),
        secondaryButtonBehavior: .custom
      )
    )
    let attributes = AlarmAttributes(
      presentation: presentation,
      metadata: VouchAlarmMetadata(reminderId: input.reminderId, taskId: input.taskId),
      tintColor: .orange
    )
    let intent = VouchOpenTaskAlarmIntent(
      taskId: input.taskId,
      reminderId: input.reminderId,
      nativeAlarmId: id.uuidString
    )
    let configuration = AlarmManager.AlarmConfiguration.alarm(
      schedule: .fixed(fireDate),
      attributes: attributes,
      secondaryIntent: intent
    )

    let alarm = try await AlarmManager.shared.schedule(id: id, configuration: configuration)
    return alarm.id.uuidString
  }
  #endif
}

private extension ISO8601DateFormatter {
  static func vouchAlarmKitDate(from value: String) -> Date? {
    vouchAlarmKitWithFractionalSeconds.date(from: value) ?? vouchAlarmKitWithoutFractionalSeconds.date(from: value)
  }

  static let vouchAlarmKitWithFractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  static let vouchAlarmKitWithoutFractionalSeconds: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter
  }()
}

#if canImport(AlarmKit)
@available(iOS 26.0, *)
public struct VouchAlarmKitAppIntentsPackage: AppIntentsPackage {
  public init() {}
}

@available(iOS 26.0, *)
struct VouchAlarmMetadata: AlarmMetadata, Codable, Sendable {
  let reminderId: String
  let taskId: String
}

@available(iOS 26.0, *)
public struct VouchOpenTaskAlarmIntent: LiveActivityIntent {
  public static var title: LocalizedStringResource = "Open App"
  public static var supportedModes: IntentModes { .foreground(.immediate) }
  public static var openAppWhenRun: Bool = true

  @Parameter(title: "Task ID") public var taskId: String
  @Parameter(title: "Reminder ID") public var reminderId: String
  @Parameter(title: "Alarm ID") public var nativeAlarmId: String

  public init() {
    self.taskId = ""
    self.reminderId = ""
    self.nativeAlarmId = ""
  }

  public init(taskId: String, reminderId: String, nativeAlarmId: String) {
    self.taskId = taskId
    self.reminderId = reminderId
    self.nativeAlarmId = nativeAlarmId
  }

  public func perform() async throws -> some IntentResult {
    NSLog("[VouchAlarmKit] Open Task intent performed taskId=%@ reminderId=%@ alarmId=%@", taskId, reminderId, nativeAlarmId)

    if let uuid = UUID(uuidString: nativeAlarmId) {
      try? AlarmManager.shared.cancel(id: uuid)
    }

    AlarmKitOpenTaskActionStore.shared.enqueue(
      AlarmKitOpenTaskAction(
        taskId: taskId,
        reminderId: reminderId,
        nativeAlarmId: nativeAlarmId
      )
    )

    return .result()
  }

  private static func openTaskURL(taskId: String, reminderId: String, nativeAlarmId: String) -> URL? {
    var components = URLComponents()
    components.scheme = "vouch"
    components.path = "/tasks/\(taskId)"
    components.queryItems = [
      URLQueryItem(name: "alarmReminderId", value: reminderId),
      URLQueryItem(name: "alarmId", value: nativeAlarmId)
    ]
    return components.url
  }
}
#endif
