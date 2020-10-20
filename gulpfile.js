'use strict';

var fs = require('fs');
var path = require('path');

var es = require('event-stream');
var globby = require('globby');
var gulp = require('gulp');
var assign = require('lodash.assign');

// load plugins
var browserSync = require('browser-sync').create();
var concat = require('gulp-concat');
var del = require('del');
var gulpif = require('gulp-if');
var order = require('gulp-order');
var requirejsOptimize = require('gulp-requirejs-optimize');
var runSequence = require('run-sequence');
var size = require('gulp-size');
var xo = require('gulp-xo');

var reload = browserSync.reload;

var generateShims = require('./gulp/generate-shims');
var processShaders = require('./gulp/process-shaders');

var runLint = function(src) {
	return gulp.src(src)
		.pipe(xo());
};

gulp.task('lint', function() {
	return runLint(['lib/**/*.js', 'gulp/**/*.js', 'gulpfile.js']);
});

gulp.task('shaders', function() {
	return gulp.src('lib/**/*.glsl')
		.pipe(processShaders())
		.pipe(gulp.dest('.tmp/shaders'));
});

gulp.task('create-main-js', function() {
	return gulp.src(['lib/**/*.js'])
		.pipe(gulpif('!main.js', generateShims()))
		.pipe(order([
			'!main.js',
			'main.js'
		]))
		.pipe(concat('main.js'))
		.pipe(gulp.dest('.tmp'));
});

function getCopyrightHeaders() {
	var copyrightHeader = fs.readFileSync('lib/copyright-header.js').toString();
	var shaderCopyrightHeader = fs.readFileSync('.tmp/shaders/shader-copyright-header.js').toString();

	return copyrightHeader + '\n' + shaderCopyrightHeader;
}

function optimize(options) {
	var source = path.join(options.baseUrl, options.include) + '.js';
	return gulp.src(source)
		.pipe(requirejsOptimize(options));
}

gulp.task('scripts', gulp.series('create-main-js', 'shaders', function() {
	var copyright = getCopyrightHeaders();

	var requirejsOptions = {
		name: '../node_modules/almond/almond',

		wrap: {
			start: copyright + '(function() {',
			end: '})();'
		},

		useStrict: true,

		inlineText: true,
		stubModules: ['text'],

		skipModuleInsertion: true,

		baseUrl: 'lib',

		include: '../.tmp/main',
		paths: {
			text: '../node_modules/requirejs-text/text'
		}
	};

	var unminified = optimize(assign({}, requirejsOptions, {
		out: 'cesium-sensor-volumes.js',
		optimize: 'none'
	}));

	var minifiedOptions = assign({}, requirejsOptions, {
		out: 'cesium-sensor-volumes.min.js',
		optimize: 'uglify2'
	});

	// Use minified versions of shaders
	globby.sync(['lib/**/*.glsl']).forEach(function(shader) {
		shader = path.relative('lib', shader).replace(/\\/g, '/').replace(/\.glsl$/, '');
		minifiedOptions.paths[shader] = path.join('../.tmp/shaders', shader);
	});

	var minified = optimize(minifiedOptions);

	return es.merge(unminified, minified).pipe(gulp.dest('dist'));
}));

gulp.task('clean', del.bind(null, ['coverage', '.tmp', 'dist']));

gulp.task('test-lint', function() {
	return runLint(['test/**/*.js']);
});

function test(done, options) {
	var Server = require('karma').Server;

	var server = new Server(assign({
		configFile: path.join(__dirname, '/test/karma.conf.js'),
		singleRun: true
	}, options), done);

	server.start();
}

gulp.task('test', gulp.series('test-lint', function(done) {
	test(done);
}));

gulp.task('test-ci', gulp.series('test-lint', function(done) {
	test(done, {
		browsers: ['Electron'],
		client: {
			args: [true]
		}
	});
}));

gulp.task('serve', function(done) {
	runSequence('build', 'run', 'watch', done);
});

gulp.task('run', function(done) {
	browserSync.init({
		server: '.'
	}, done);
});

gulp.task('watch', function() {
	gulp.watch(['examples/**/*.html', 'examples/**/*.czml'], reload);
	gulp.watch(['lib/**/*.glsl'], ['build-reload']);
	gulp.watch(['lib/**/*.js'], ['build-reload']);
});



gulp.task('build', gulp.series('lint', 'scripts', function() {
	return gulp.src('dist/**/*')
		.pipe(size({ title: 'build', gzip: true }));
}));

gulp.task('build-reload', gulp.series('build', reload));

gulp.task('ci', function(done) {
	runSequence('lint', 'test-ci', 'build', done);
});

gulp.task('default', function(done) {
	runSequence('clean', 'build', done);
});
