// ignore: unused_import
import 'package:intl/intl.dart' as intl;

import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appName => 'JANTOK';

  @override
  String get retry => 'Retry';

  @override
  String get loading => 'Loading…';

  @override
  String get offlineTitle => 'No connection';

  @override
  String get offlineBody =>
      'Your data was not removed. Retry when the connection is restored.';

  @override
  String get empty => 'No data yet';

  @override
  String get continueAction => 'Continue';

  @override
  String get save => 'Save';

  @override
  String get cancel => 'Cancel';

  @override
  String get close => 'Close';

  @override
  String get home => 'Home';

  @override
  String get menu => 'Menu';

  @override
  String get delivery => 'Delivery';

  @override
  String get club => 'CLUB';

  @override
  String get profile => 'Profile';

  @override
  String get language => 'Language';

  @override
  String get kazakh => 'Қазақша';

  @override
  String get russian => 'Русский';

  @override
  String get english => 'English';

  @override
  String get onboardingTitle => 'Daily meals for your family';

  @override
  String get onboardingBody =>
      'A personal menu, morning delivery, and safe ingredients for every family member.';

  @override
  String get onboardingPrivacy =>
      'Payment and health data are protected. You can change your choices at any time.';

  @override
  String get loginTitle => 'Sign in to JANTOK';

  @override
  String get phone => 'Phone number';

  @override
  String get firstName => 'First name';

  @override
  String get lastName => 'Last name';

  @override
  String get referral => 'Referral code (optional)';

  @override
  String get sendCode => 'Get code';

  @override
  String get resendCode => 'Resend code';

  @override
  String get otp => 'SMS code';

  @override
  String get codeSent => 'Code sent';

  @override
  String get todayMeals => 'Today\'s family meals';

  @override
  String get nextDelivery => 'Next delivery';

  @override
  String get subscription => 'Subscription';

  @override
  String get active => 'Active';

  @override
  String get noSubscription => 'No active subscription';

  @override
  String get startSubscription => 'Choose meals';

  @override
  String get quickActions => 'Quick actions';

  @override
  String get addons => 'Add-ons';

  @override
  String get payments => 'Payments';

  @override
  String get support => 'Support';

  @override
  String get family => 'Family';

  @override
  String get addresses => 'Addresses';

  @override
  String get calendar => 'Calendar';

  @override
  String get selectMember => 'Family member';

  @override
  String get sevenDayMenu => '7-day menu';

  @override
  String get breakfast => 'Breakfast';

  @override
  String get lunch => 'Lunch';

  @override
  String get dinner => 'Dinner';

  @override
  String get mealDetails => 'Meal details';

  @override
  String get composition => 'Ingredients';

  @override
  String get allergens => 'Allergens';

  @override
  String get reviews => 'Reviews';

  @override
  String get noPhoto => 'No photo provided';

  @override
  String get allergyWarning =>
      'This meal may not be suitable for the selected member';

  @override
  String get safeForMember => 'Safe for this member';

  @override
  String get noMenu => 'No menu has been published for this period';

  @override
  String get deliveryTracking => 'Delivery tracking';

  @override
  String get etaUnavailable => 'ETA is temporarily unavailable';

  @override
  String get trackingUnavailable =>
      'The provider did not supply coordinates. No simulated marker is shown.';

  @override
  String get callCourier => 'Call courier';

  @override
  String get contactSupport => 'Report a problem';

  @override
  String get bonusBalance => 'Bonus balance';

  @override
  String get invitedFriends => 'Invited friends';

  @override
  String get progress => 'Progress to next level';

  @override
  String get account => 'Account';

  @override
  String get notifications => 'Notifications';

  @override
  String get sessions => 'Sessions';

  @override
  String get logout => 'Log out';

  @override
  String get serviceNotifications => 'Service push';

  @override
  String get marketingNotifications => 'Marketing push';

  @override
  String get savedMethods => 'Saved payment methods';

  @override
  String get paymentHistory => 'Payment history';

  @override
  String get autoRenew => 'Auto-renew';

  @override
  String get checkout => 'Checkout';

  @override
  String get quote => 'Calculate';

  @override
  String get promoCode => 'Promo code';

  @override
  String get bonusesToSpend => 'Bonuses to spend';

  @override
  String get total => 'Total';

  @override
  String get pay => 'Pay';

  @override
  String get paymentPending => 'Payment is awaiting provider confirmation';

  @override
  String get familyQuestionnaire => 'Family questionnaire';

  @override
  String get recommendation => 'Recommendation';

  @override
  String get subscriptionCalendar => 'Subscription calendar';

  @override
  String get remainingDays => 'Remaining days';

  @override
  String get pause => 'Pause';

  @override
  String get skipDay => 'Skip day';

  @override
  String get guest => 'Guest';

  @override
  String get newRequest => 'New request';

  @override
  String get myReviews => 'My reviews';

  @override
  String get settingsApplied => 'The change was saved on the server';

  @override
  String get brandAssetsMissing =>
      'Temporary wordmark. Approved brand assets have not been supplied yet.';

  @override
  String daysCount(num count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days',
      one: '1 day',
      zero: 'no days',
    );
    return '$_temp0';
  }

  @override
  String currency(Object amount) {
    return '₸$amount';
  }

  @override
  String calories(Object value) {
    return '$value kcal';
  }

  @override
  String grams(Object value) {
    return '$value g';
  }

  @override
  String get addMember => 'Add family member';

  @override
  String get birthDate => 'Date of birth (YYYY-MM-DD)';

  @override
  String get heightCm => 'Height, cm';

  @override
  String get weightKg => 'Weight, kg';

  @override
  String get activityLevel => 'Activity level';

  @override
  String get sportIntensity => 'Sport intensity';

  @override
  String get sportHours => 'Sport hours per week';

  @override
  String get goal => 'Goal';

  @override
  String get dietType => 'Diet type';

  @override
  String get portionSize => 'Portion';

  @override
  String get allergy => 'Allergy';

  @override
  String get otherAllergy => 'Other allergy';

  @override
  String get notes => 'Notes';

  @override
  String get saveQuestionnaire => 'Save questionnaire';

  @override
  String get female => 'Female';

  @override
  String get male => 'Male';

  @override
  String get notSpecified => 'Prefer not to say';

  @override
  String get none => 'None';

  @override
  String get light => 'Light';

  @override
  String get moderate => 'Moderate';

  @override
  String get high => 'High';

  @override
  String get loseWeight => 'Lose weight';

  @override
  String get maintainWeight => 'Maintain weight';

  @override
  String get gainWeight => 'Gain weight';

  @override
  String get sportGoal => 'Sport goal';

  @override
  String get recommended => 'Recommended';

  @override
  String get small => 'Small';

  @override
  String get standard => 'Standard';

  @override
  String get large => 'Large';

  @override
  String get generateRecommendation => 'Calculate recommendation';

  @override
  String get deliveryAddress => 'Delivery address';

  @override
  String get questionnaireSaved => 'Questionnaire saved on the server';

  @override
  String get requiredFields => 'Check the required fields';

  @override
  String get biologicalSex => 'Sex';

  @override
  String get attachPhoto => 'Attach photo';

  @override
  String get photoReady => 'Photo ready to send';

  @override
  String get refund => 'Request refund';

  @override
  String get refundReason => 'Refund reason';

  @override
  String get receipts => 'Receipts';

  @override
  String get refunds => 'Refunds';

  @override
  String get quantity => 'Quantity';

  @override
  String get recurringAddon => 'Recurring on subscription days';

  @override
  String get createReview => 'Write a review';

  @override
  String get rating => 'Rating';

  @override
  String get comment => 'Comment';

  @override
  String get noDeliveredMeals =>
      'There is no delivered meal available to review';
}
