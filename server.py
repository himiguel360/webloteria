import http.server, ssl, os
PORT = 8080
os.chdir(os.path.dirname(os.path.abspath(__file__)))
handler = http.server.SimpleHTTPRequestHandler
httpd = http.server.HTTPServer(('0.0.0.0', PORT), handler)
print(f'Serving on http://0.0.0.0:{PORT}')
httpd.serve_forever()
