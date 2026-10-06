import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_kk.dart';
import 'app_localizations_ru.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('kk'),
    Locale('ru'),
  ];

  /// No description provided for @appName.
  ///
  /// In kk, this message translates to:
  /// **'JANTOK'**
  String get appName;

  /// No description provided for @retry.
  ///
  /// In kk, this message translates to:
  /// **'Қайталау'**
  String get retry;

  /// No description provided for @loading.
  ///
  /// In kk, this message translates to:
  /// **'Жүктелуде…'**
  String get loading;

  /// No description provided for @offlineTitle.
  ///
  /// In kk, this message translates to:
  /// **'Байланыс жоқ'**
  String get offlineTitle;

  /// No description provided for @offlineBody.
  ///
  /// In kk, this message translates to:
  /// **'Деректер өшірілмеді. Интернет қосылғанда қайта көріңіз.'**
  String get offlineBody;

  /// No description provided for @empty.
  ///
  /// In kk, this message translates to:
  /// **'Әзірге дерек жоқ'**
  String get empty;

  /// No description provided for @continueAction.
  ///
  /// In kk, this message translates to:
  /// **'Жалғастыру'**
  String get continueAction;

  /// No description provided for @save.
  ///
  /// In kk, this message translates to:
  /// **'Сақтау'**
  String get save;

  /// No description provided for @cancel.
  ///
  /// In kk, this message translates to:
  /// **'Бас тарту'**
  String get cancel;

  /// No description provided for @close.
  ///
  /// In kk, this message translates to:
  /// **'Жабу'**
  String get close;

  /// No description provided for @home.
  ///
  /// In kk, this message translates to:
  /// **'Басты бет'**
  String get home;

  /// No description provided for @menu.
  ///
  /// In kk, this message translates to:
  /// **'Мәзір'**
  String get menu;

  /// No description provided for @delivery.
  ///
  /// In kk, this message translates to:
  /// **'Жеткізу'**
  String get delivery;

  /// No description provided for @club.
  ///
  /// In kk, this message translates to:
  /// **'CLUB'**
  String get club;

  /// No description provided for @profile.
  ///
  /// In kk, this message translates to:
  /// **'Профиль'**
  String get profile;

  /// No description provided for @language.
  ///
  /// In kk, this message translates to:
  /// **'Тіл'**
  String get language;

  /// No description provided for @kazakh.
  ///
  /// In kk, this message translates to:
  /// **'Қазақша'**
  String get kazakh;

  /// No description provided for @russian.
  ///
  /// In kk, this message translates to:
  /// **'Русский'**
  String get russian;

  /// No description provided for @english.
  ///
  /// In kk, this message translates to:
  /// **'English'**
  String get english;

  /// No description provided for @onboardingTitle.
  ///
  /// In kk, this message translates to:
  /// **'Отбасыңызға арналған күнделікті ас'**
  String get onboardingTitle;

  /// No description provided for @onboardingBody.
  ///
  /// In kk, this message translates to:
  /// **'Жеке мәзір, таңғы жеткізу және әр отбасы мүшесіне қауіпсіз құрам.'**
  String get onboardingBody;

  /// No description provided for @onboardingPrivacy.
  ///
  /// In kk, this message translates to:
  /// **'Төлем мен денсаулық деректері қорғалған. Таңдауды кез келген уақытта өзгерте аласыз.'**
  String get onboardingPrivacy;

  /// No description provided for @loginTitle.
  ///
  /// In kk, this message translates to:
  /// **'JANTOK-қа кіру'**
  String get loginTitle;

  /// No description provided for @phone.
  ///
  /// In kk, this message translates to:
  /// **'Телефон нөмірі'**
  String get phone;

  /// No description provided for @firstName.
  ///
  /// In kk, this message translates to:
  /// **'Аты'**
  String get firstName;

  /// No description provided for @lastName.
  ///
  /// In kk, this message translates to:
  /// **'Тегі'**
  String get lastName;

  /// No description provided for @referral.
  ///
  /// In kk, this message translates to:
  /// **'Referral коды (міндетті емес)'**
  String get referral;

  /// No description provided for @sendCode.
  ///
  /// In kk, this message translates to:
  /// **'Кодты алу'**
  String get sendCode;

  /// No description provided for @resendCode.
  ///
  /// In kk, this message translates to:
  /// **'Кодты қайта жіберу'**
  String get resendCode;

  /// No description provided for @otp.
  ///
  /// In kk, this message translates to:
  /// **'SMS коды'**
  String get otp;

  /// No description provided for @codeSent.
  ///
  /// In kk, this message translates to:
  /// **'Код жіберілді'**
  String get codeSent;

  /// No description provided for @todayMeals.
  ///
  /// In kk, this message translates to:
  /// **'Бүгінгі отбасы мәзірі'**
  String get todayMeals;

  /// No description provided for @nextDelivery.
  ///
  /// In kk, this message translates to:
  /// **'Келесі жеткізу'**
  String get nextDelivery;

  /// No description provided for @subscription.
  ///
  /// In kk, this message translates to:
  /// **'Жазылым'**
  String get subscription;

  /// No description provided for @active.
  ///
  /// In kk, this message translates to:
  /// **'Белсенді'**
  String get active;

  /// No description provided for @noSubscription.
  ///
  /// In kk, this message translates to:
  /// **'Белсенді жазылым жоқ'**
  String get noSubscription;

  /// No description provided for @startSubscription.
  ///
  /// In kk, this message translates to:
  /// **'Рационды таңдау'**
  String get startSubscription;

  /// No description provided for @quickActions.
  ///
  /// In kk, this message translates to:
  /// **'Жылдам әрекеттер'**
  String get quickActions;

  /// No description provided for @addons.
  ///
  /// In kk, this message translates to:
  /// **'Қосымшалар'**
  String get addons;

  /// No description provided for @payments.
  ///
  /// In kk, this message translates to:
  /// **'Төлемдер'**
  String get payments;

  /// No description provided for @support.
  ///
  /// In kk, this message translates to:
  /// **'Қолдау'**
  String get support;

  /// No description provided for @family.
  ///
  /// In kk, this message translates to:
  /// **'Отбасы'**
  String get family;

  /// No description provided for @addresses.
  ///
  /// In kk, this message translates to:
  /// **'Мекенжайлар'**
  String get addresses;

  /// No description provided for @calendar.
  ///
  /// In kk, this message translates to:
  /// **'Күнтізбе'**
  String get calendar;

  /// No description provided for @selectMember.
  ///
  /// In kk, this message translates to:
  /// **'Отбасы мүшесі'**
  String get selectMember;

  /// No description provided for @sevenDayMenu.
  ///
  /// In kk, this message translates to:
  /// **'7 күндік мәзір'**
  String get sevenDayMenu;

  /// No description provided for @breakfast.
  ///
  /// In kk, this message translates to:
  /// **'Таңғы ас'**
  String get breakfast;

  /// No description provided for @lunch.
  ///
  /// In kk, this message translates to:
  /// **'Түскі ас'**
  String get lunch;

  /// No description provided for @dinner.
  ///
  /// In kk, this message translates to:
  /// **'Кешкі ас'**
  String get dinner;

  /// No description provided for @mealDetails.
  ///
  /// In kk, this message translates to:
  /// **'Тағам туралы'**
  String get mealDetails;

  /// No description provided for @composition.
  ///
  /// In kk, this message translates to:
  /// **'Құрамы'**
  String get composition;

  /// No description provided for @allergens.
  ///
  /// In kk, this message translates to:
  /// **'Аллергендер'**
  String get allergens;

  /// No description provided for @reviews.
  ///
  /// In kk, this message translates to:
  /// **'Пікірлер'**
  String get reviews;

  /// No description provided for @noPhoto.
  ///
  /// In kk, this message translates to:
  /// **'Фото берілмеген'**
  String get noPhoto;

  /// No description provided for @allergyWarning.
  ///
  /// In kk, this message translates to:
  /// **'Бұл тағам таңдалған қатысушыға сәйкес келмеуі мүмкін'**
  String get allergyWarning;

  /// No description provided for @safeForMember.
  ///
  /// In kk, this message translates to:
  /// **'Қатысушыға қауіпсіз'**
  String get safeForMember;

  /// No description provided for @noMenu.
  ///
  /// In kk, this message translates to:
  /// **'Бұл кезеңге жарияланған мәзір жоқ'**
  String get noMenu;

  /// No description provided for @deliveryTracking.
  ///
  /// In kk, this message translates to:
  /// **'Жеткізуді бақылау'**
  String get deliveryTracking;

  /// No description provided for @etaUnavailable.
  ///
  /// In kk, this message translates to:
  /// **'ETA уақытша қолжетімсіз'**
  String get etaUnavailable;

  /// No description provided for @trackingUnavailable.
  ///
  /// In kk, this message translates to:
  /// **'Провайдер координаттарды бермеді. Жалған нүкте көрсетілмейді.'**
  String get trackingUnavailable;

  /// No description provided for @callCourier.
  ///
  /// In kk, this message translates to:
  /// **'Курьерге қоңырау шалу'**
  String get callCourier;

  /// No description provided for @contactSupport.
  ///
  /// In kk, this message translates to:
  /// **'Мәселе туралы хабарлау'**
  String get contactSupport;

  /// No description provided for @bonusBalance.
  ///
  /// In kk, this message translates to:
  /// **'Бонус балансы'**
  String get bonusBalance;

  /// No description provided for @invitedFriends.
  ///
  /// In kk, this message translates to:
  /// **'Шақырылған достар'**
  String get invitedFriends;

  /// No description provided for @progress.
  ///
  /// In kk, this message translates to:
  /// **'Келесі деңгейге дейін'**
  String get progress;

  /// No description provided for @account.
  ///
  /// In kk, this message translates to:
  /// **'Аккаунт'**
  String get account;

  /// No description provided for @notifications.
  ///
  /// In kk, this message translates to:
  /// **'Хабарландырулар'**
  String get notifications;

  /// No description provided for @sessions.
  ///
  /// In kk, this message translates to:
  /// **'Сессиялар'**
  String get sessions;

  /// No description provided for @logout.
  ///
  /// In kk, this message translates to:
  /// **'Шығу'**
  String get logout;

  /// No description provided for @serviceNotifications.
  ///
  /// In kk, this message translates to:
  /// **'Қызметтік push'**
  String get serviceNotifications;

  /// No description provided for @marketingNotifications.
  ///
  /// In kk, this message translates to:
  /// **'Маркетингтік push'**
  String get marketingNotifications;

  /// No description provided for @savedMethods.
  ///
  /// In kk, this message translates to:
  /// **'Сақталған төлем әдістері'**
  String get savedMethods;

  /// No description provided for @paymentHistory.
  ///
  /// In kk, this message translates to:
  /// **'Төлем тарихы'**
  String get paymentHistory;

  /// No description provided for @autoRenew.
  ///
  /// In kk, this message translates to:
  /// **'Автоматты ұзарту'**
  String get autoRenew;

  /// No description provided for @checkout.
  ///
  /// In kk, this message translates to:
  /// **'Төлем'**
  String get checkout;

  /// No description provided for @quote.
  ///
  /// In kk, this message translates to:
  /// **'Есептеу'**
  String get quote;

  /// No description provided for @promoCode.
  ///
  /// In kk, this message translates to:
  /// **'Промокод'**
  String get promoCode;

  /// No description provided for @bonusesToSpend.
  ///
  /// In kk, this message translates to:
  /// **'Жұмсалатын бонус'**
  String get bonusesToSpend;

  /// No description provided for @total.
  ///
  /// In kk, this message translates to:
  /// **'Барлығы'**
  String get total;

  /// No description provided for @pay.
  ///
  /// In kk, this message translates to:
  /// **'Төлеу'**
  String get pay;

  /// No description provided for @paymentPending.
  ///
  /// In kk, this message translates to:
  /// **'Төлем провайдердің растауын күтуде'**
  String get paymentPending;

  /// No description provided for @familyQuestionnaire.
  ///
  /// In kk, this message translates to:
  /// **'Отбасы сауалнамасы'**
  String get familyQuestionnaire;

  /// No description provided for @recommendation.
  ///
  /// In kk, this message translates to:
  /// **'Ұсыныс'**
  String get recommendation;

  /// No description provided for @subscriptionCalendar.
  ///
  /// In kk, this message translates to:
  /// **'Жазылым күнтізбесі'**
  String get subscriptionCalendar;

  /// No description provided for @remainingDays.
  ///
  /// In kk, this message translates to:
  /// **'Қалған күндер'**
  String get remainingDays;

  /// No description provided for @pause.
  ///
  /// In kk, this message translates to:
  /// **'Үзіліс'**
  String get pause;

  /// No description provided for @skipDay.
  ///
  /// In kk, this message translates to:
  /// **'Күнді өткізу'**
  String get skipDay;

  /// No description provided for @guest.
  ///
  /// In kk, this message translates to:
  /// **'Қонақ'**
  String get guest;

  /// No description provided for @newRequest.
  ///
  /// In kk, this message translates to:
  /// **'Жаңа өтініш'**
  String get newRequest;

  /// No description provided for @myReviews.
  ///
  /// In kk, this message translates to:
  /// **'Менің пікірлерім'**
  String get myReviews;

  /// No description provided for @settingsApplied.
  ///
  /// In kk, this message translates to:
  /// **'Өзгеріс серверде сақталды'**
  String get settingsApplied;

  /// No description provided for @brandAssetsMissing.
  ///
  /// In kk, this message translates to:
  /// **'Уақытша мәтіндік белгі. Бекітілген бренд ассеттері әлі берілмеді.'**
  String get brandAssetsMissing;

  /// No description provided for @daysCount.
  ///
  /// In kk, this message translates to:
  /// **'{count, plural, =0{күн жоқ} =1{1 күн} other{{count} күн}}'**
  String daysCount(num count);

  /// No description provided for @currency.
  ///
  /// In kk, this message translates to:
  /// **'{amount} ₸'**
  String currency(Object amount);

  /// No description provided for @calories.
  ///
  /// In kk, this message translates to:
  /// **'{value} ккал'**
  String calories(Object value);

  /// No description provided for @grams.
  ///
  /// In kk, this message translates to:
  /// **'{value} г'**
  String grams(Object value);

  /// No description provided for @addMember.
  ///
  /// In kk, this message translates to:
  /// **'Қатысушы қосу'**
  String get addMember;

  /// No description provided for @birthDate.
  ///
  /// In kk, this message translates to:
  /// **'Туған күні (YYYY-MM-DD)'**
  String get birthDate;

  /// No description provided for @heightCm.
  ///
  /// In kk, this message translates to:
  /// **'Бойы, см'**
  String get heightCm;

  /// No description provided for @weightKg.
  ///
  /// In kk, this message translates to:
  /// **'Салмағы, кг'**
  String get weightKg;

  /// No description provided for @activityLevel.
  ///
  /// In kk, this message translates to:
  /// **'Белсенділік деңгейі'**
  String get activityLevel;

  /// No description provided for @sportIntensity.
  ///
  /// In kk, this message translates to:
  /// **'Спорт қарқындылығы'**
  String get sportIntensity;

  /// No description provided for @sportHours.
  ///
  /// In kk, this message translates to:
  /// **'Аптасына спорт сағаты'**
  String get sportHours;

  /// No description provided for @goal.
  ///
  /// In kk, this message translates to:
  /// **'Мақсат'**
  String get goal;

  /// No description provided for @dietType.
  ///
  /// In kk, this message translates to:
  /// **'Тамақтану түрі'**
  String get dietType;

  /// No description provided for @portionSize.
  ///
  /// In kk, this message translates to:
  /// **'Порция'**
  String get portionSize;

  /// No description provided for @allergy.
  ///
  /// In kk, this message translates to:
  /// **'Аллергия'**
  String get allergy;

  /// No description provided for @otherAllergy.
  ///
  /// In kk, this message translates to:
  /// **'Басқа аллергия'**
  String get otherAllergy;

  /// No description provided for @notes.
  ///
  /// In kk, this message translates to:
  /// **'Ескертпе'**
  String get notes;

  /// No description provided for @saveQuestionnaire.
  ///
  /// In kk, this message translates to:
  /// **'Сауалнаманы сақтау'**
  String get saveQuestionnaire;

  /// No description provided for @female.
  ///
  /// In kk, this message translates to:
  /// **'Әйел'**
  String get female;

  /// No description provided for @male.
  ///
  /// In kk, this message translates to:
  /// **'Ер'**
  String get male;

  /// No description provided for @notSpecified.
  ///
  /// In kk, this message translates to:
  /// **'Көрсетпеу'**
  String get notSpecified;

  /// No description provided for @none.
  ///
  /// In kk, this message translates to:
  /// **'Жоқ'**
  String get none;

  /// No description provided for @light.
  ///
  /// In kk, this message translates to:
  /// **'Жеңіл'**
  String get light;

  /// No description provided for @moderate.
  ///
  /// In kk, this message translates to:
  /// **'Орташа'**
  String get moderate;

  /// No description provided for @high.
  ///
  /// In kk, this message translates to:
  /// **'Жоғары'**
  String get high;

  /// No description provided for @loseWeight.
  ///
  /// In kk, this message translates to:
  /// **'Салмақ азайту'**
  String get loseWeight;

  /// No description provided for @maintainWeight.
  ///
  /// In kk, this message translates to:
  /// **'Салмақты сақтау'**
  String get maintainWeight;

  /// No description provided for @gainWeight.
  ///
  /// In kk, this message translates to:
  /// **'Салмақ қосу'**
  String get gainWeight;

  /// No description provided for @sportGoal.
  ///
  /// In kk, this message translates to:
  /// **'Спорттық мақсат'**
  String get sportGoal;

  /// No description provided for @recommended.
  ///
  /// In kk, this message translates to:
  /// **'Ұсынылған'**
  String get recommended;

  /// No description provided for @small.
  ///
  /// In kk, this message translates to:
  /// **'Кіші'**
  String get small;

  /// No description provided for @standard.
  ///
  /// In kk, this message translates to:
  /// **'Стандарт'**
  String get standard;

  /// No description provided for @large.
  ///
  /// In kk, this message translates to:
  /// **'Үлкен'**
  String get large;

  /// No description provided for @generateRecommendation.
  ///
  /// In kk, this message translates to:
  /// **'Ұсынысты есептеу'**
  String get generateRecommendation;

  /// No description provided for @deliveryAddress.
  ///
  /// In kk, this message translates to:
  /// **'Жеткізу мекенжайы'**
  String get deliveryAddress;

  /// No description provided for @questionnaireSaved.
  ///
  /// In kk, this message translates to:
  /// **'Сауалнама серверде сақталды'**
  String get questionnaireSaved;

  /// No description provided for @requiredFields.
  ///
  /// In kk, this message translates to:
  /// **'Міндетті өрістерді тексеріңіз'**
  String get requiredFields;

  /// No description provided for @biologicalSex.
  ///
  /// In kk, this message translates to:
  /// **'Жынысы'**
  String get biologicalSex;

  /// No description provided for @attachPhoto.
  ///
  /// In kk, this message translates to:
  /// **'Фото тіркеу'**
  String get attachPhoto;

  /// No description provided for @photoReady.
  ///
  /// In kk, this message translates to:
  /// **'Фото жіберуге дайын'**
  String get photoReady;

  /// No description provided for @refund.
  ///
  /// In kk, this message translates to:
  /// **'Қайтаруды сұрау'**
  String get refund;

  /// No description provided for @refundReason.
  ///
  /// In kk, this message translates to:
  /// **'Қайтару себебі'**
  String get refundReason;

  /// No description provided for @receipts.
  ///
  /// In kk, this message translates to:
  /// **'Түбіртектер'**
  String get receipts;

  /// No description provided for @refunds.
  ///
  /// In kk, this message translates to:
  /// **'Қайтарулар'**
  String get refunds;

  /// No description provided for @quantity.
  ///
  /// In kk, this message translates to:
  /// **'Саны'**
  String get quantity;

  /// No description provided for @recurringAddon.
  ///
  /// In kk, this message translates to:
  /// **'Жазылым күндеріне тұрақты'**
  String get recurringAddon;

  /// No description provided for @createReview.
  ///
  /// In kk, this message translates to:
  /// **'Пікір қалдыру'**
  String get createReview;

  /// No description provided for @rating.
  ///
  /// In kk, this message translates to:
  /// **'Баға'**
  String get rating;

  /// No description provided for @comment.
  ///
  /// In kk, this message translates to:
  /// **'Пікір'**
  String get comment;

  /// No description provided for @noDeliveredMeals.
  ///
  /// In kk, this message translates to:
  /// **'Пікір қалдыруға болатын жеткізілген тағам жоқ'**
  String get noDeliveredMeals;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'kk', 'ru'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'kk':
      return AppLocalizationsKk();
    case 'ru':
      return AppLocalizationsRu();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
