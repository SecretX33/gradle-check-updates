import java.time.LocalDate
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
}

group = "com.example.web.api"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<KotlinCompile> {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.set(listOf(
            "-Xjsr305=strict",
            "-Xannotation-default-target=param-property"
        ))
    }
    // Enable caching for Kotlin compilation outputs
    outputs.cacheIf { true }
}

configurations {
    compileOnly {
        extendsFrom(configurations.annotationProcessor.get())
    }
}

dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:web:m1-data"))
    implementation(project(":app:web:m2-core"))
    implementation(project(":app:web:m2-services"))
    implementation(project(":app:content:m2-services"))
    implementation(project(":app:supply:m2-services"))
    implementation(project(":app:ai:m2-services"))
    implementation(project(":app:ai:m5-api"))
    implementation(project(":app:web:admin"))

    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.boot.starter.security)
    implementation(libs.spring.boot.starter.actuator)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.spring.boot.starter.cache)
    implementation(libs.spring.session.data.redis)
    implementation(libs.spring.boot.starter.data.redis)
    implementation(libs.postgresql)
    implementation(libs.jedis)

    implementation(libs.bundles.kotlin.core)
    implementation(libs.bundles.kotlin.coroutines)

    implementation(libs.hypersistence.utils)

    implementation(libs.bundles.jwt)

    implementation(libs.commons.lang3)
    implementation(libs.commons.csv)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.h2)
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.assertj.core)

    // Spring Boot Security
    implementation(libs.auth0.spring.security)
    implementation(libs.spring.security.oauth2.client)
    implementation(libs.spring.security.config)

    // OSV dependencies
    implementation(libs.protobuf.java)

    // cache clients
    implementation(libs.guava)

    // DB Migrations
    implementation(libs.liquibase.core)

    // Annotation Processor
    annotationProcessor(libs.spring.boot.configuration.processor)

    // Google maps
    implementation(libs.google.maps.services)
    implementation(libs.google.maps.places)
    implementation(libs.google.maps.routing)

    // Logback
    implementation(libs.logstash.logback.encoder)
    implementation(libs.opentelemetry.logback.appender)
    implementation(libs.opentelemetry.logback.mdc)

    // Telnyx
    implementation(libs.telnyx)
    implementation(libs.jsoup)
    implementation(libs.commons.codec)
    implementation(libs.bouncycastle)

    // Slack
    implementation(libs.slack)

    // Logbook for HTTP request/response logging
    implementation(libs.logbook.spring.boot.starter)
    implementation(libs.logbook.logstash)
    implementation(libs.logbook.httpclient5)
    implementation(libs.logbook.spring.webflux)

    // OSV test dependencies
    testImplementation(libs.xmlunit.core)
}

// Version: Use BUILD_VERSION from CI, or generate locally (YYYY-MM-DD.HHMM-shortSha)
val buildVersion: Provider<String> = providers.environmentVariable("BUILD_VERSION")
    .orElse(
        providers.environmentVariable("GIT_SHA")
            .map { sha ->
                val date = LocalDate.now().toString()
                val time = LocalTime.now().format(DateTimeFormatter.ofPattern("HHmm"))
                "$date.$time-${sha.take(9)}"
            }
    )
    .orElse(
        providers.exec {
            commandLine("git", "rev-parse", "--short", "HEAD")
            isIgnoreExitValue = true
        }.standardOutput.asText.map { sha ->
            val trimmed = sha.trim()
            val date = LocalDate.now().toString()
            val time = LocalTime.now().format(DateTimeFormatter.ofPattern("HHmm"))
            if (trimmed.isNotEmpty()) "$date.$time-$trimmed" else "$date.$time-local"
        }
    )

tasks.processResources {
    val version = buildVersion.get()
    filesMatching("application.properties") {
        filter { it.replace("@buildVersion@", version) }
    }
}

tasks.jar {
    enabled = false
}

tasks.bootJar {
    enabled = true
    archiveBaseName.set("web-api")
    archiveClassifier.set("")
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.compilerArgs.add("-parameters")
}

tasks.named<org.springframework.boot.gradle.tasks.run.BootRun>("bootRun") {
    jvmArgs = listOf(
        // Skip C2 JIT compilation for faster startup (~30-50% faster boot)
        "-XX:TieredStopAtLevel=1",

        // CodeCache settings to prevent exhaustion during long dev sessions
        "-XX:ReservedCodeCacheSize=512m",
        "-XX:InitialCodeCacheSize=256m",
        "-XX:+UseCodeCacheFlushing",

        // Memory settings for local development
        "-Xms512m",
        "-Xmx4g",
    )
}
