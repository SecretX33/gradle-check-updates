import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
    id("java-test-fixtures")
}

group = "com.example.content.data"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

noArg {
    annotation("jakarta.persistence.Entity")
    annotation("jakarta.persistence.MappedSuperclass")
    annotation("jakarta.persistence.Embeddable")
    invokeInitializers = true
}

allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("jakarta.persistence.MappedSuperclass")
    annotation("jakarta.persistence.Embeddable")
    annotation("org.springframework.stereotype.Component")
    annotation("org.springframework.stereotype.Repository")
    annotation("org.springframework.stereotype.Service")
}

dependencies {
    implementation(project(":app:common"))

    // Spring Boot & JPA
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.data.commons)
    implementation(libs.jakarta.persistence.api)

    // Database
    implementation(libs.postgresql)
    implementation(libs.liquibase.core)
    implementation(libs.hypersistence.utils)

    implementation(libs.jts.core)

    // Jackson & Utils
    implementation(libs.commons.csv)
    implementation(libs.commons.lang3)

    // Kotlin
    implementation(libs.kotlin.stdlib)
    implementation(libs.kotlin.reflect)

    annotationProcessor(libs.spring.boot.configuration.processor)

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation(libs.h2)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.assertj.core)

    // Testcontainers for JSONB serialization integration tests
    testImplementation(libs.testcontainers.junit.jupiter)
    testImplementation(libs.testcontainers.postgresql)

    testFixturesImplementation(libs.kotlin.stdlib)
    testFixturesImplementation(libs.jakarta.persistence.api)
    testFixturesImplementation(project(":app:common"))
}

tasks.jar {
    enabled = true
    archiveBaseName.set("content-data")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        // Update JVM target to 21
        jvmTarget.set(JvmTarget.JVM_21)
    }

    // Enable caching for Kotlin compilation
    outputs.cacheIf { true }
}
