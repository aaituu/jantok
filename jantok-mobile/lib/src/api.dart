import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';

import 'config.dart';

class ApiException implements Exception {
  ApiException(this.code, this.message);
  final String code;
  final String message;
  @override
  String toString() => message;
}

class ApiClient {
  ApiClient(this.storage);
  final FlutterSecureStorage storage;
  static String get baseUrl => AppConfig.apiBaseUrl;

  Future<String> deviceId() async {
    final existing = await storage.read(key: 'device_id');
    if (existing != null) return existing;
    final value =
        '${DateTime.now().microsecondsSinceEpoch}-${Platform.operatingSystem}';
    await storage.write(key: 'device_id', value: value);
    return value;
  }

  Future<Object?> callObject(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    final headers = {'content-type': 'application/json'};
    if (authenticated) {
      final token = await storage.read(key: 'access_token');
      if (token != null) headers['authorization'] = 'Bearer $token';
    }
    final uri = Uri.parse('$baseUrl$path');
    final response = await switch (method) {
      'GET' => http.get(uri, headers: headers),
      'DELETE' => http.delete(uri, headers: headers),
      'PUT' => http.put(uri, headers: headers, body: jsonEncode(body)),
      'PATCH' => http.patch(uri, headers: headers, body: jsonEncode(body)),
      _ => http.post(uri, headers: headers, body: jsonEncode(body)),
    }.timeout(const Duration(seconds: 20));
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body);
    if (response.statusCode >= 400) {
      final error = decoded is Map<String, dynamic>
          ? decoded['error'] as Map<String, dynamic>?
          : null;
      throw ApiException(
        '${error?['code'] ?? 'REQUEST_FAILED'}',
        '${error?['message'] ?? 'Request failed'}',
      );
    }
    return decoded;
  }

  Future<Map<String, dynamic>> call(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    final value = await callObject(
      method,
      path,
      body: body,
      authenticated: authenticated,
    );
    if (value is Map<String, dynamic>) return value;
    throw ApiException('INVALID_RESPONSE', 'Expected an object response');
  }

  Future<List<dynamic>> callList(
    String method,
    String path, {
    Object? body,
    bool authenticated = true,
  }) async {
    final value = await callObject(
      method,
      path,
      body: body,
      authenticated: authenticated,
    );
    if (value is List<dynamic>) return value;
    throw ApiException('INVALID_RESPONSE', 'Expected a list response');
  }

  Future<Map<String, dynamic>> uploadSupportPhoto(XFile file) async {
    final token = await storage.read(key: 'access_token');
    final bytes = await file.readAsBytes();
    final lower = file.name.toLowerCase();
    final contentType = lower.endsWith('.png')
        ? 'image/png'
        : lower.endsWith('.webp')
        ? 'image/webp'
        : 'image/jpeg';
    final request = http.MultipartRequest(
      'POST',
      Uri.parse('$baseUrl/support/attachments'),
    );
    if (token != null) request.headers['authorization'] = 'Bearer $token';
    request.files.add(
      http.MultipartFile.fromBytes(
        'file',
        bytes,
        filename: file.name,
        contentType: MediaType.parse(contentType),
      ),
    );
    final streamed = await request.send().timeout(const Duration(seconds: 30));
    final response = await http.Response.fromStream(streamed);
    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode >= 400) {
      final error = decoded['error'] as Map<String, dynamic>?;
      throw ApiException(
        '${error?['code'] ?? 'UPLOAD_FAILED'}',
        '${error?['message'] ?? 'Photo upload failed'}',
      );
    }
    return decoded;
  }

  Future<void> saveTokens(Map<String, dynamic> data) async {
    await storage.write(
      key: 'access_token',
      value: data['accessToken'] as String,
    );
    await storage.write(
      key: 'refresh_token',
      value: data['refreshToken'] as String,
    );
  }

  Future<bool> refresh() async {
    final token = await storage.read(key: 'refresh_token');
    if (token == null) return false;
    try {
      final result = await call(
        'POST',
        '/auth/refresh',
        authenticated: false,
        body: {'refreshToken': token},
      );
      await saveTokens(result);
      return true;
    } catch (_) {
      await clear();
      return false;
    }
  }

  Future<void> clear() async {
    await storage.delete(key: 'access_token');
    await storage.delete(key: 'refresh_token');
  }
}
